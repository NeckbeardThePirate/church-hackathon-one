/**
 * Stage handlers for the Learn pipeline (docs/learn-plan.md §3).
 * M1 scope: intake → scope → plan → [teach → check] per lesson → critic → assemble.
 * Scripture readings are proposed by the model as references only; text comes from D1.
 */
import { findBibleReferences } from "@/app/lib/bible/parse-reference";
import {
  LESSON_BANDS,
  type ArticleResource,
  type VideoResource,
  type Complexity,
  type LearnLesson,
  type LearnPlan,
  type LessonOutline,
  type Perspective,
  type QuizItem,
  type ScopeResult,
  type ScriptureReading,
  type TeachBlock,
} from "@/app/lib/learn/types";
import { fetchPassageFromD1 } from "../bible-db";
import { exaSearch, exaVerify, YOUTUBE_DOMAINS, youtubeId, youtubeOembed } from "./exa";
import { list, llmJson, num, obj, str, strList, type LlmMeta, type LlmRole } from "./llm";
import type { LearnPlanDO } from "./plan-do";
import { enqueue, enqueueMany, type LearnEnv, type LearnMessage } from "./queues";

export class BudgetExhausted extends Error {}

type Ctx = {
  env: LearnEnv;
  msg: LearnMessage;
  stub: DurableObjectStub<LearnPlanDO>;
};

type PlanInfo = Awaited<ReturnType<LearnPlanDO["info"]>>;

async function llm<T>(
  ctx: Ctx,
  role: LlmRole,
  call: { system: string; user: string; validate: (v: unknown) => T; maxTokens?: number; temperature?: number },
): Promise<T> {
  if (!(await ctx.stub.spend("llm", 1))) throw new BudgetExhausted("LLM call budget reached.");
  const meta: LlmMeta = { planId: ctx.msg.planId, stage: ctx.msg.stage, lessonId: ctx.msg.lessonId };
  return llmJson(ctx.env, { role, meta, ...call });
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/* =============================== S0 intake =============================== */

export async function runIntake(ctx: Ctx): Promise<void> {
  const info = await ctx.stub.info();
  await ctx.stub.event("intake", `Topic received (${info.notes ? "with notes" : "no notes"}).`);
  await enqueue(ctx.env, { planId: ctx.msg.planId, stage: "scope", round: 0 });
}

/* =============================== S1 scope =============================== */

const SCOPE_SYSTEM = `You design learning plans. Assess the scope of the topic the learner gives you.
Complexity bands:
- simple: single concept or one skill; under about 1 hour total; 1-2 lessons
- moderate: several linked concepts with a few prerequisites; 3-5 lessons
- complex: a broad field or multi-stage topic with a deep prerequisite chain; 6-10 lessons
Return JSON:
{"title":"short course title","complexity":"simple"|"moderate"|"complex","lessonCount":number,
 "prerequisites":["what the learner should already know"],"coreConcepts":["..."],
 "objectives":["3-6 course outcomes, each starting with a verb"],
 "isFaithRelevant":boolean}
isFaithRelevant is true when the topic involves the Bible, Christian theology, church history, or Christian practice.`;

export async function runScope(ctx: Ctx): Promise<void> {
  const info = await ctx.stub.info();
  const scope = await llm(ctx, "planner", {
    system: SCOPE_SYSTEM,
    user: `Topic: ${info.topic}\n${info.notes ? `Learner notes:\n"""\n${clip(info.notes, 6000)}\n"""` : ""}`,
    validate: (value): ScopeResult => {
      const o = obj(value);
      const complexity = o.complexity as Complexity;
      if (!(complexity in LESSON_BANDS)) throw new Error("complexity must be simple, moderate, or complex");
      const band = LESSON_BANDS[complexity];
      return {
        title: str(o.title, "title"),
        complexity,
        // Model proposes; code clamps to the band (§3 S1).
        lessonCount: clamp(num(o.lessonCount, band.min), band.min, band.max),
        prerequisites: strList(o.prerequisites, "prerequisites"),
        coreConcepts: strList(o.coreConcepts, "coreConcepts"),
        objectives: strList(o.objectives, "objectives", { min: 1 }).slice(0, 6),
        isFaithRelevant: o.isFaithRelevant === true,
      };
    },
  });

  if (info.options.includeScripture === "yes") scope.isFaithRelevant = true;
  if (info.options.includeScripture === "no") scope.isFaithRelevant = false;

  await ctx.stub.setScope(scope);
  await ctx.stub.event(
    "scope",
    `${scope.complexity[0]!.toUpperCase()}${scope.complexity.slice(1)} topic → ${scope.lessonCount} lesson${
      scope.lessonCount === 1 ? "" : "s"
    }${scope.isFaithRelevant ? " · scripture on" : ""}`,
  );
  await enqueue(ctx.env, { planId: ctx.msg.planId, stage: "plan", round: 0 });
}

/* =============================== S2 plan =============================== */

export async function runPlan(ctx: Ctx): Promise<void> {
  const info = await ctx.stub.info();
  const scope = await requireScope(ctx);
  const band = LESSON_BANDS[scope.complexity];
  const n = scope.lessonCount;

  const outlines = await llm(ctx, "planner", {
    system: `You turn a course scope into an ordered lesson outline. Each lesson builds on earlier ones.
Return JSON:
{"lessons":[{"title":"","objectives":["2-4, verb-first"],"prerequisiteLessons":[earlier lesson numbers, 1-based],
 "estimatedMinutes":number,"searchHints":["2-4 queries a librarian would use to find videos, articles and books for this lesson"]}]}
Return exactly ${n} lessons. estimatedMinutes between ${band.minutes[0]} and ${band.minutes[1]}.`,
    user: `Course: ${scope.title}
Topic: ${info.topic}
Prerequisites: ${scope.prerequisites.join("; ") || "none"}
Core concepts: ${scope.coreConcepts.join("; ")}
Course objectives:\n${scope.objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")}
${info.notes ? `Learner notes:\n"""\n${clip(info.notes, 4000)}\n"""` : ""}`,
    validate: (value): LessonOutline[] => {
      const raw = list(obj(value).lessons, "lessons", { min: n });
      return raw.slice(0, n).map((item, index) => {
        const o = obj(item, `lessons[${index}]`);
        const order = index + 1;
        return {
          id: `l${order}`,
          order,
          title: str(o.title, `lessons[${index}].title`),
          objectives: strList(o.objectives, `lessons[${index}].objectives`, { min: 1 }).slice(0, 4),
          // Only earlier lessons: guarantees no cycles or orphans.
          prerequisiteLessonIds: (Array.isArray(o.prerequisiteLessons) ? o.prerequisiteLessons : [])
            .map((p) => Math.round(Number(p)))
            .filter((p) => Number.isInteger(p) && p >= 1 && p < order)
            .map((p) => `l${p}`),
          estimatedMinutes: clamp(num(o.estimatedMinutes, band.minutes[0]), band.minutes[0], band.minutes[1]),
          searchHints: strList(o.searchHints ?? [], `lessons[${index}].searchHints`).slice(0, 4),
        };
      });
    },
  });

  await ctx.stub.setOutline(outlines);
  await ctx.stub.event("plan", `${outlines.length} lessons: ${outlines.map((l) => l.title).join(" · ")}`);
  await enqueueMany(
    ctx.env,
    outlines.map((l) => ({ planId: ctx.msg.planId, stage: "research" as const, lessonId: l.id, round: ctx.msg.round })),
  );
}

/* =============================== S3/S4 research + verify (Exa) =============================== */

type Candidate = {
  url: string;
  title: string;
  author?: string;
  publishedDate?: string;
  /** Extracted page text (articles) or description text (videos). Grounds the review. */
  text: string;
  videoId?: string;
  channel?: string;
};
type ResearchScratch = { articles: Candidate[]; videos: Candidate[] };

const ARTICLE_TEXT_CHARS = 3000;

export async function runResearch(ctx: Ctx): Promise<void> {
  const lessonId = requireLessonId(ctx);
  const lesson = await ctx.stub.getLesson(lessonId);
  if (!lesson) throw new Error(`Lesson ${lessonId} not found.`);
  const scope = await requireScope(ctx);
  const apiKey = ctx.env.EXA_API_KEY;
  const next = { planId: ctx.msg.planId, lessonId, round: ctx.msg.round };

  if (!apiKey) {
    await ctx.stub.event("research", `L${lesson.order}: Exa not configured, skipping videos and articles.`, lessonId);
    await enqueue(ctx.env, { ...next, stage: "teach" });
    return;
  }

  const base = `${scope.title}: ${lesson.title}`;
  const queries = [...new Set([lesson.searchHints[0] ?? base, lesson.searchHints[1]].filter(Boolean) as string[])].slice(0, 2);
  // 2 article searches + 1 video search + 1 verify call = 4 Exa calls per lesson (budget: 12/lesson, 120/plan).
  if (!(await ctx.stub.spend("exa", queries.length + 2))) throw new BudgetExhausted("Exa call budget reached.");

  const [articleSets, videoResults] = await Promise.all([
    Promise.all(
      queries.map((query) =>
        exaSearch(apiKey, { query, numResults: 5, excludeDomains: YOUTUBE_DOMAINS, textChars: ARTICLE_TEXT_CHARS }),
      ),
    ),
    exaSearch(apiKey, { query: `${base} explained`, numResults: 6, includeDomains: YOUTUBE_DOMAINS, textChars: 800 }),
  ]);

  const seen = new Set<string>();
  const articles: Candidate[] = articleSets
    .flat()
    .filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
    .map((r) => ({
      url: r.url,
      title: r.title,
      author: r.author,
      publishedDate: r.publishedDate,
      text: (r.text || r.highlights?.join(" ") || "").slice(0, ARTICLE_TEXT_CHARS),
    }))
    .filter((c) => c.text.length > 200);

  // S4 verify (code only). Articles: Exa /contents per-URL status. Videos: YouTube oEmbed.
  const { live, dropped } = await exaVerify(
    apiKey,
    articles.map((a) => a.url),
  );
  const verifiedArticles = articles.filter((a) => live.has(a.url));

  const videoCandidates = videoResults
    .map((r) => ({ r, videoId: youtubeId(r.url) }))
    .filter((v): v is { r: (typeof videoResults)[number]; videoId: string } => !!v.videoId)
    .filter((v, i, all) => all.findIndex((o) => o.videoId === v.videoId) === i);
  const oembeds = await Promise.all(videoCandidates.map((v) => youtubeOembed(v.videoId)));
  const videos: Candidate[] = videoCandidates.flatMap((v, i) => {
    const meta = oembeds[i];
    if (!meta) return [];
    return [
      {
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        // Title and channel from YouTube, not from search or the model.
        title: meta.title,
        channel: meta.channel,
        videoId: v.videoId,
        publishedDate: v.r.publishedDate,
        text: (v.r.text || v.r.highlights?.join(" ") || "").slice(0, 800),
      },
    ];
  });
  const videosDropped = videoCandidates.length - videos.length;

  await ctx.stub.putScratch(`research:${lessonId}`, { articles: verifiedArticles, videos } satisfies ResearchScratch);
  const droppedTotal = dropped.size + videosDropped;
  await ctx.stub.event(
    "research",
    `L${lesson.order}: ${verifiedArticles.length} articles, ${videos.length} videos verified${
      droppedTotal ? ` · ${droppedTotal} dropped (unreachable or unavailable)` : ""
    }`,
    lessonId,
  );
  await enqueue(ctx.env, { ...next, stage: verifiedArticles.length || videos.length ? "review" : "teach" });
}

/* =============================== S5 select + review =============================== */

const MAX_ARTICLES = 3;
const MAX_VIDEOS = 2;

export async function runReview(ctx: Ctx): Promise<void> {
  const lessonId = requireLessonId(ctx);
  const info = await ctx.stub.info();
  const scope = await requireScope(ctx);
  const lessons = await ctx.stub.getLessons();
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) throw new Error(`Lesson ${lessonId} not found.`);
  const research = ((await ctx.stub.getScratch(`research:${lessonId}`)) as ResearchScratch | undefined) ?? { articles: [], videos: [] };

  // Best-effort cross-lesson dedupe: skip URLs another lesson already picked.
  const taken = new Set(lessons.filter((l) => l.id !== lessonId).flatMap((l) => [...l.articles, ...l.videos].map((r) => r.url)));
  const articles = research.articles.filter((a) => !taken.has(a.url));
  const videos = research.videos.filter((v) => !taken.has(v.url));

  const tagRule = scope.isFaithRelevant
    ? `"perspective": the source's evident Christian tradition or stance (e.g. "Reformed", "Catholic", "Evangelical", "Academic", "Unclear"). Judge only from the text given.`
    : `"perspective": always "".`;

  const picks = await llm(ctx, "worker", {
    temperature: 0.2,
    system: `You choose study resources for one lesson and review them for the learner.
Pick only from the numbered candidates. Choose up to ${MAX_ARTICLES} articles (A#) and up to ${MAX_VIDEOS} videos (V#) that best serve the lesson objectives. Skip weak, off-topic, or low-quality items; fewer is fine.
For each pick write "review": 1-2 sentences on what it covers, who it suits, and any caveat. Base it only on the text shown; do not invent ratings, view counts, or facts not in the text.
${tagRule}
Return JSON: {"articles":[{"id":"A1","review":"","perspective":""}],"videos":[{"id":"V1","review":"","perspective":""}]}`,
    user: `Lesson: ${lesson.title}
Objectives: ${lesson.objectives.join("; ")}
${scope.isFaithRelevant && info.options.perspective !== "neutral" ? `Learner's tradition: ${info.options.perspective} (prefer, but do not exclude, other views).` : ""}

Articles:
${articles.map((a, i) => `A${i + 1}. ${a.title}${a.author ? ` — ${a.author}` : ""} (${hostOf(a.url)})\n${clip(a.text, 900)}`).join("\n\n") || "none"}

Videos:
${videos.map((v, i) => `V${i + 1}. ${v.title} — ${v.channel}\n${clip(v.text, 400)}`).join("\n\n") || "none"}`,
    validate: (value) => {
      const o = obj(value);
      const pick = <C>(raw: unknown, prefix: string, pool: C[], max: number) => {
        const used = new Set<number>();
        return (Array.isArray(raw) ? raw : []).flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const r = item as Record<string, unknown>;
          const index = Number(String(r.id ?? "").replace(prefix, "")) - 1;
          const candidate = pool[index];
          // Model can only point at candidates; unknown ids are ignored, never invented.
          if (!candidate || used.has(index) || used.size >= max) return [];
          used.add(index);
          return [{ candidate, review: typeof r.review === "string" ? r.review.trim() : "", perspective: typeof r.perspective === "string" ? r.perspective.trim() : "" }];
        });
      };
      return { articles: pick(o.articles, "A", articles, MAX_ARTICLES), videos: pick(o.videos, "V", videos, MAX_VIDEOS) };
    },
  });

  const chosenArticles: ArticleResource[] = picks.articles.map(({ candidate, review, perspective }) => ({
    url: candidate.url,
    title: candidate.title,
    siteName: hostOf(candidate.url),
    review,
    reviewBasis: "text",
    ...(perspective ? { perspective } : {}),
  }));
  const chosenVideos: VideoResource[] = picks.videos.map(({ candidate, review, perspective }) => ({
    url: candidate.url,
    title: candidate.title,
    channel: candidate.channel ?? "",
    videoId: candidate.videoId ?? "",
    review,
    // Video reviews are from description text only (no transcript): labeled accordingly.
    reviewBasis: "metadata",
    ...(perspective ? { perspective } : {}),
  }));

  const fresh = await ctx.stub.getLesson(lessonId);
  await ctx.stub.putLesson({ ...(fresh ?? lesson), articles: chosenArticles, videos: chosenVideos });
  await ctx.stub.event(
    "review",
    `L${lesson.order}: picked ${chosenArticles.length} articles, ${chosenVideos.length} videos (from ${articles.length + videos.length} verified)`,
    lessonId,
  );
  await enqueue(ctx.env, { planId: ctx.msg.planId, stage: "teach", lessonId, round: ctx.msg.round });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/* =============================== S6/S7 teach + quiz =============================== */

function perspectiveRules(isFaithRelevant: boolean, perspective: Perspective): string {
  if (!isFaithRelevant) return "";
  const base = `Never quote Bible verse text. Cite references only (e.g. "Romans 3:21-26"); verified text is inserted later.`;
  if (perspective === "neutral") {
    return `${base}
Where Christian traditions disagree on this subject, present each main position in its own block, attributed ("Catholic teaching holds…", "Reformed theology holds…"). Do not take a side.`;
  }
  return `${base}
Teach from the ${perspective} tradition's standards and attribute it ("The ${perspective} tradition holds…, because…").
Where other traditions disagree, add a heading2 "Other perspectives" and give each main position, attributed.
Never present the ${perspective} view as settled for all Christians.`;
}

const TEACH_TYPES: TeachBlock["type"][] = ["paragraph", "heading1", "heading2", "bullet", "numbered", "quote", "divider"];

function parseQuizItems(value: unknown, path: string, objectiveCount: number): QuizItem[] {
  return list(value, path).flatMap((item, i): QuizItem[] => {
    const o = obj(item, `${path}[${i}]`);
    const kind = o.kind === "short" ? "short" : "mc";
    const question = str(o.question, `${path}[${i}].question`);
    const answer = str(o.answer, `${path}[${i}].answer`);
    const rationale = str(o.rationale, `${path}[${i}].rationale`, { optional: true });
    const objectiveIndex = clamp(num(o.objectiveIndex, 0), 0, Math.max(0, objectiveCount - 1));
    if (kind === "mc") {
      const choices = strList(o.choices, `${path}[${i}].choices`, { min: 2 }).slice(0, 5);
      if (!choices.includes(answer)) throw new Error(`${path}[${i}]: answer must exactly equal one of the choices`);
      return [{ kind, question, choices, answer, rationale, objectiveIndex }];
    }
    return [{ kind, question, answer, rationale, objectiveIndex }];
  });
}

const QUIZ_RULES = `Quiz rules: multiple choice ("mc") items have 4 choices and "answer" must exactly equal one choice.
Short-answer ("short") items have a one-sentence answer. Every item must be answerable from the lesson text alone.
objectiveIndex is the 0-based index of the lesson objective the item tests.`;

export async function runTeach(ctx: Ctx): Promise<void> {
  const lessonId = requireLessonId(ctx);
  const info = await ctx.stub.info();
  const scope = await requireScope(ctx);
  const lessons = await ctx.stub.getLessons();
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) throw new Error(`Lesson ${lessonId} not found.`);
  const band = LESSON_BANDS[scope.complexity];
  const repair = await ctx.stub.repairNote(lessonId);

  const result = await llm(ctx, "worker", {
    maxTokens: 6000,
    system: `You write one lesson of a course for an adult learner.
Return JSON:
{"teaching":[{"type":"heading2"|"paragraph"|"bullet"|"numbered"|"quote"|"divider","text":""}],
 "quiz":[{"kind":"mc"|"short","question":"","choices":["",""],"answer":"","rationale":"","objectiveIndex":0}],
 "scriptureRefs":[{"reference":"Book C:V-V","note":"one sentence on why it connects"}]}
teaching: 5-12 blocks. Cover every objective: explanation, key ideas, a worked example or illustration,
and end with a heading2 "Discuss" followed by 2-3 bullet discussion questions. Keep each block short.
quiz: ${band.quiz[0]}-${band.quiz[1]} items. ${QUIZ_RULES}
scriptureRefs: ${scope.isFaithRelevant ? "1-3 passages central to this lesson" : "always an empty array"}.
${
  repair
    ? `A reviewer asked for a fix. If the fix requires changing what the lesson covers, also return "objectives": [2-4 revised, verb-first objectives] and write the teaching and quiz against those. objectiveIndex refers to the revised list.`
    : ""
}
${perspectiveRules(scope.isFaithRelevant, info.options.perspective)}`,
    user: `Course: ${scope.title} (${scope.complexity})
Lesson ${lesson.order} of ${lessons.length}: ${lesson.title}
Objectives:\n${lesson.objectives.map((o, i) => `${i}. ${o}`).join("\n")}
Builds on: ${lesson.prerequisiteLessonIds.map((id) => lessons.find((l) => l.id === id)?.title).filter(Boolean).join("; ") || "nothing"}
Other lessons (do not repeat their content): ${lessons.filter((l) => l.id !== lessonId).map((l) => l.title).join("; ") || "none"}
Target length: about ${lesson.estimatedMinutes} minutes of study.
${
  lesson.articles.length || lesson.videos.length
    ? `Recommended resources the learner will see (you may point to them by title; do not invent others):\n${[
        ...lesson.videos.map((v) => `- Video: ${v.title} (${v.channel})`),
        ...lesson.articles.map((a) => `- Article: ${a.title} (${a.siteName ?? ""})`),
      ].join("\n")}`
    : ""
}
${info.notes ? `Learner notes:\n"""\n${clip(info.notes, 3000)}\n"""` : ""}
${repair ? `Reviewer asked for this fix: ${repair}` : ""}`,
    validate: (value) => {
      const o = obj(value);
      // Objectives may change only on a critic repair (outline-level fixes).
      const objectives =
        repair && Array.isArray(o.objectives) ? strList(o.objectives, "objectives").slice(0, 4) : lesson.objectives;
      if (!objectives.length) throw new Error("objectives must not be empty");
      const teaching: TeachBlock[] = list(o.teaching, "teaching", { min: 3 }).flatMap((item, i) => {
        const b = obj(item, `teaching[${i}]`);
        const type = TEACH_TYPES.includes(b.type as TeachBlock["type"]) ? (b.type as TeachBlock["type"]) : "paragraph";
        const text = typeof b.text === "string" ? b.text.trim() : "";
        if (type !== "divider" && !text) return [];
        return [{ type, text }];
      });
      const quiz = parseQuizItems(o.quiz, "quiz", objectives.length).slice(0, band.quiz[1]);
      if (quiz.length < band.quiz[0]) throw new Error(`quiz needs at least ${band.quiz[0]} valid items`);
      const refs = Array.isArray(o.scriptureRefs)
        ? o.scriptureRefs.flatMap((r) => {
            if (!r || typeof r !== "object") return [];
            const rec = r as Record<string, unknown>;
            return typeof rec.reference === "string"
              ? [{ reference: rec.reference, note: typeof rec.note === "string" ? rec.note : "" }]
              : [];
          })
        : [];
      return { objectives, teaching, quiz, refs };
    },
  });

  const { readings, dropped } = scope.isFaithRelevant
    ? await verifyScripture(ctx.env, result.refs.slice(0, 3))
    : { readings: [], dropped: [] as string[] };

  const warnings = dropped.map((ref) => `Scripture reference dropped (did not resolve in BSB): ${ref}`);
  await ctx.stub.putLesson({
    ...lesson,
    objectives: result.objectives,
    teaching: result.teaching,
    quiz: result.quiz,
    scripture: readings,
    warnings,
  });
  await ctx.stub.event(
    "teach",
    `L${lesson.order} ${lesson.title}: ${result.teaching.length} blocks, ${result.quiz.length} quiz items${
      scope.isFaithRelevant ? `, ${readings.length} readings${dropped.length ? ` (${dropped.length} dropped)` : ""}` : ""
    }`,
    lessonId,
  );
  await enqueue(ctx.env, { planId: ctx.msg.planId, stage: "check", lessonId, round: ctx.msg.round });
}

/** S4 verify for scripture: reference must parse and resolve in D1; text is never model-generated. */
async function verifyScripture(
  env: LearnEnv,
  refs: { reference: string; note: string }[],
): Promise<{ readings: ScriptureReading[]; dropped: string[] }> {
  const readings: ScriptureReading[] = [];
  const dropped: string[] = [];
  for (const { reference, note } of refs) {
    const ref = findBibleReferences(reference)[0];
    const passage =
      ref && env.BIBLE
        ? await fetchPassageFromD1(env.BIBLE, ref.book.slug, ref.chapter, ref.verseStart, ref.verseEnd).catch(() => null)
        : null;
    if (!passage) {
      dropped.push(reference);
      continue;
    }
    if (readings.some((r) => r.reference === passage.reference)) continue;
    readings.push({ reference: passage.reference, text: passage.verses.map((v) => v.text).join(" "), note });
  }
  return { readings, dropped };
}

/* =============================== S8 lesson check =============================== */

function lessonText(lesson: LearnLesson): string {
  return lesson.teaching.map((b) => (b.type === "divider" ? "---" : b.text)).join("\n");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Returns indexes of items the checker could not answer correctly from the lesson text. */
async function checkQuiz(ctx: Ctx, lesson: LearnLesson, items: QuizItem[]): Promise<Set<number>> {
  const student = await llm(ctx, "worker", {
    temperature: 0,
    system: `You are a student who has read only the lesson below. Answer each question using only the lesson text.
For multiple choice, answer with the exact text of one choice. If the lesson does not contain the answer, answer "NOT IN LESSON".
Return JSON: {"answers":[{"index":0,"answer":""}]}`,
    user: `Lesson:\n"""\n${clip(lessonText(lesson), 9000)}\n"""\n\nQuestions:\n${items
      .map((q, i) => `${i}. ${q.question}${q.choices ? `\n   Choices: ${q.choices.map((c) => `"${c}"`).join(", ")}` : ""}`)
      .join("\n")}`,
    validate: (value) => {
      const answers = new Map<number, string>();
      for (const a of list(obj(value).answers, "answers")) {
        const o = obj(a, "answer");
        answers.set(Math.round(num(o.index, -1)), typeof o.answer === "string" ? o.answer.trim() : "");
      }
      return answers;
    },
  });

  const failed = new Set<number>();
  const shortToGrade: number[] = [];
  items.forEach((item, i) => {
    const given = student.get(i) ?? "";
    if (!given || /not in lesson/i.test(given)) failed.add(i);
    else if (item.kind === "mc") {
      if (norm(given) !== norm(item.answer)) failed.add(i);
    } else shortToGrade.push(i);
  });

  if (shortToGrade.length) {
    const verdicts = await llm(ctx, "worker", {
      temperature: 0,
      system: `Grade short answers. For each, decide if the student's answer means substantially the same as the key.
Return JSON: {"verdicts":[{"index":0,"correct":true}]}`,
      user: shortToGrade
        .map((i) => `${i}. Q: ${items[i]!.question}\n   Key: ${items[i]!.answer}\n   Student: ${student.get(i)}`)
        .join("\n"),
      validate: (value) => {
        const out = new Map<number, boolean>();
        for (const v of list(obj(value).verdicts, "verdicts")) {
          const o = obj(v, "verdict");
          out.set(Math.round(num(o.index, -1)), o.correct === true);
        }
        return out;
      },
    });
    for (const i of shortToGrade) if (!verdicts.get(i)) failed.add(i);
  }
  return failed;
}

export async function runCheck(ctx: Ctx): Promise<void> {
  const lessonId = requireLessonId(ctx);
  const scope = await requireScope(ctx);
  const band = LESSON_BANDS[scope.complexity];
  const lesson = await ctx.stub.getLesson(lessonId);
  if (!lesson) throw new Error(`Lesson ${lessonId} not found.`);

  let quiz = lesson.quiz;
  const warnings = [...lesson.warnings];
  let regenerated = 0;
  let droppedCount = 0;

  try {
    const failed = await checkQuiz(ctx, lesson, quiz);
    if (failed.size) {
      const bad = [...failed].map((i) => quiz[i]!);
      // One regeneration pass for failing items (§3 S8).
      const replacements = await llm(ctx, "worker", {
        system: `Rewrite quiz items so each is clearly answerable from the lesson text alone.
Return JSON: {"quiz":[{"kind":"mc"|"short","question":"","choices":[""],"answer":"","rationale":"","objectiveIndex":0}]}
Return exactly ${bad.length} items. ${QUIZ_RULES}`,
        user: `Lesson objectives:\n${lesson.objectives.map((o, i) => `${i}. ${o}`).join("\n")}\n\nLesson:\n"""\n${clip(
          lessonText(lesson),
          9000,
        )}\n"""\n\nItems that failed:\n${bad.map((q) => `- ${q.question} (key: ${q.answer})`).join("\n")}`,
        validate: (value) => parseQuizItems(obj(value).quiz, "quiz", lesson.objectives.length),
      });
      regenerated = replacements.length;
      const stillFailed = replacements.length ? await checkQuiz(ctx, lesson, replacements) : new Set<number>();
      const kept = quiz.filter((_, i) => !failed.has(i));
      const fixed = replacements.filter((_, i) => !stillFailed.has(i));
      droppedCount = quiz.length - kept.length - fixed.length;
      quiz = [...kept, ...fixed];
    }
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    warnings.push("Quiz check skipped: LLM budget reached.");
  }

  if (droppedCount > 0) warnings.push(`${droppedCount} quiz item(s) dropped: not answerable from the lesson.`);
  const status = quiz.length >= band.quiz[0] ? "ok" : "degraded";
  if (status === "degraded") warnings.push(`Quiz has ${quiz.length} items; band minimum is ${band.quiz[0]}.`);

  await ctx.stub.putLesson({ ...lesson, quiz, warnings, status });
  await ctx.stub.event(
    "check",
    `L${lesson.order}: ${quiz.length}/${lesson.quiz.length} quiz items confirmed${
      regenerated ? ` · ${regenerated} regenerated` : ""
    }${droppedCount ? ` · ${droppedCount} dropped` : ""}`,
    lessonId,
  );
  await finishLesson(ctx, lessonId);
}

/** Fan-in: when the last lesson of the round finishes, queue the critic. */
export async function finishLesson(ctx: Ctx, lessonId: string): Promise<void> {
  if (await ctx.stub.lessonDone(lessonId, ctx.msg.round)) {
    await enqueue(ctx.env, { planId: ctx.msg.planId, stage: "critic", round: ctx.msg.round });
  }
}

/* =============================== S9 course critic =============================== */

const MAX_REPAIR_ROUNDS = 2;

export async function runCritic(ctx: Ctx): Promise<void> {
  const scope = await requireScope(ctx);
  const lessons = await ctx.stub.getLessons();
  const band = LESSON_BANDS[scope.complexity];
  const totalMinutes = lessons.reduce((sum, l) => sum + l.estimatedMinutes, 0);

  let issues: { lessonId: string; issue: string }[] = [];
  try {
    issues = await llm(ctx, "planner", {
      system: `You review a course outline before it ships. Check: every course objective is covered;
no two lessons substantially duplicate each other; lessons are in a sensible prerequisite order;
each lesson's teaching matches its objectives. Only report problems a rewrite of one lesson would fix.
Return JSON: {"issues":[{"lesson":number,"issue":"specific instruction for the rewrite"}]} (empty array if fine).`,
      user: `Course: ${scope.title} (${scope.complexity}, ${totalMinutes} min total)
Course objectives:\n${scope.objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")}

${lessons
  .map(
    (l) => `Lesson ${l.order}: ${l.title}
  Objectives: ${l.objectives.join("; ")}
  Teaching: ${clip(lessonText(l).replace(/\n+/g, " "), 700)}`,
  )
  .join("\n\n")}`,
      validate: (value) =>
        list(obj(value).issues ?? [], "issues").flatMap((item) => {
          const o = obj(item, "issue");
          const order = Math.round(num(o.lesson, -1));
          const lesson = lessons.find((l) => l.order === order);
          const issue = typeof o.issue === "string" ? o.issue.trim() : "";
          return lesson && issue ? [{ lessonId: lesson.id, issue }] : [];
        }),
    });
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
  }

  const round = ctx.msg.round;
  if (issues.length && round < MAX_REPAIR_ROUNDS) {
    const notes: Record<string, string> = {};
    for (const { lessonId, issue } of issues) notes[lessonId] = notes[lessonId] ? `${notes[lessonId]} ${issue}` : issue;
    const nextRound = await ctx.stub.reopen(notes);
    await ctx.stub.event(
      "critic",
      `${Object.keys(notes).length} repair${Object.keys(notes).length === 1 ? "" : "s"}: ${Object.entries(notes)
        .map(([id, note]) => `L${lessons.find((l) => l.id === id)?.order} ${clip(note, 80)}`)
        .join(" · ")}`,
    );
    await enqueueMany(
      ctx.env,
      Object.keys(notes).map((lessonId) => ({ planId: ctx.msg.planId, stage: "teach" as const, lessonId, round: nextRound })),
    );
    return;
  }

  if (issues.length) {
    for (const { lessonId, issue } of issues) {
      const lesson = lessons.find((l) => l.id === lessonId);
      if (lesson) await ctx.stub.putLesson({ ...lesson, warnings: [...lesson.warnings, `Reviewer: ${issue}`] });
    }
  }
  await ctx.stub.event(
    "critic",
    issues.length
      ? `Shipping with ${issues.length} open reviewer note(s) after ${MAX_REPAIR_ROUNDS} repair rounds.`
      : `Course review passed (${totalMinutes} min, band ${band.min}-${band.max} lessons).`,
  );
  await enqueue(ctx.env, { planId: ctx.msg.planId, stage: "assemble", round });
}

/* =============================== S10 assemble =============================== */

export async function runAssemble(ctx: Ctx): Promise<void> {
  const info = await ctx.stub.info();
  const scope = await requireScope(ctx);
  const band = LESSON_BANDS[scope.complexity];
  const warnings: string[] = [];
  let partial = info.deadlineHit;

  const lessons = (await ctx.stub.getLessons()).map((lesson): LearnLesson => {
    if (lesson.status !== "pending" && lesson.teaching.length) return lesson;
    partial = true;
    return { ...lesson, status: "degraded", warnings: [...lesson.warnings, "Not finished within the plan's budget."] };
  });

  let finalAssessment: QuizItem[] = [];
  const ready = lessons.filter((l) => l.teaching.length);
  if (band.finalItems > 0 && ready.length && !info.deadlineHit) {
    try {
      finalAssessment = await llm(ctx, "worker", {
        maxTokens: 5000,
        system: `Write a final assessment for a course. Mix items across all lessons, favoring questions that connect lessons.
Return JSON: {"quiz":[{"kind":"mc"|"short","question":"","choices":[""],"answer":"","rationale":"","objectiveIndex":0}]}
Return exactly ${band.finalItems} items. ${QUIZ_RULES} objectiveIndex refers to the course objectives.`,
        user: `Course objectives:\n${scope.objectives.map((o, i) => `${i}. ${o}`).join("\n")}\n\n${ready
          .map((l) => `Lesson ${l.order}: ${l.title}\n${clip(lessonText(l), 1500)}`)
          .join("\n\n")}`,
        validate: (value) =>
          parseQuizItems(obj(value).quiz, "quiz", scope.objectives.length).slice(0, band.finalItems),
      });
    } catch (error) {
      if (!(error instanceof BudgetExhausted)) throw error;
      warnings.push("Final assessment skipped: LLM budget reached.");
    }
  }

  if (info.deadlineHit) warnings.push("Time budget reached; some lessons may be incomplete.");
  const lessonWarnings = lessons.reduce((n, l) => n + l.warnings.length, 0);

  const plan: LearnPlan = {
    id: ctx.msg.planId,
    topic: info.topic,
    title: scope.title,
    complexity: scope.complexity,
    perspective: info.options.perspective,
    status: partial ? "partial" : "complete",
    prerequisites: scope.prerequisites,
    objectives: scope.objectives,
    lessons,
    courseBooks: [],
    finalAssessment,
    warnings: [...warnings, ...(lessonWarnings ? [`${lessonWarnings} lesson-level warning(s).`] : [])],
    createdAt: info.createdAt,
  };
  await ctx.stub.event("assemble", `Assembled ${lessons.length} lessons${finalAssessment.length ? ` + ${finalAssessment.length}-item final` : ""}.`);
  await ctx.stub.complete(plan);
}

/* =============================== helpers =============================== */

async function requireScope(ctx: Ctx): Promise<ScopeResult> {
  const scope = await ctx.stub.getScope();
  if (!scope) throw new Error("Scope missing; plan stage ran before scope.");
  return scope;
}

function requireLessonId(ctx: Ctx): string {
  if (!ctx.msg.lessonId) throw new Error(`${ctx.msg.stage} message is missing lessonId.`);
  return ctx.msg.lessonId;
}

export type { Ctx, PlanInfo };

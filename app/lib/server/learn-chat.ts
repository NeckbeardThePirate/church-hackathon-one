import { findBibleReferences } from "../bible/parse-reference";
import type { LearnChatContext, LearnChatInput, LearnChatMessage, SerializedLesson } from "../learn/agent-context";
import { isPerspective } from "../learn/types";
import { runWorkersAi, workersGatewayCall } from "./ai-gateway";
import { fetchPassagesFromD1 } from "./bible-db";
import { citeLibrary } from "./learn/library-cite";
import { retrievalFocus } from "./learn/library-rank";
import {
  LEARN_MAX_TOKENS,
  LEARN_THINKING_EFFORT,
  callAnthropic,
  learnModelId,
  readAnthropicText,
  warnIfMaxTokensStop,
  type LlmEnv,
} from "./learn/llm";
import { SOURCE_TEXT_RULE } from "./learn/source-policy";

const clip = (text: string | undefined, n: number) => {
  const t = (text ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const SYSTEM = `You are a patient tutor inside a structured learning course. The learner sees one screen at a time; you receive the course metadata and the materials for their current focus (overview, one lesson, or final assessment).

Rules:
- Ground explanations in the TEACHING text and in scripture, confession, commentary, or church-father passages provided in the context.
- ${SOURCE_TEXT_RULE}
- When RETRIEVED FOR THIS QUESTION is present, cite it. Name each scripture reference you use, quote only that retrieved wording, and name a library source by its label when you use it. Do not answer a passage question with no citation when a retrieved passage is in the context.
- When the focus is a practice (gap) lesson or a review item, use the same rule: quote only the retrieved wording in that focus, and do not write any other verse, confession, commentary, or church-father text.
- Refer to a lesson by its title. Never abbreviate a lesson as L1, L2, or any other L-number.
- When mentioning a video, article, or book, name it and you may mention its URL from the context.
- Do not invent resources, URLs, or ratings that are not in the context.
- Quiz: help the learner think through questions without giving away answers unless they paste their attempt and ask you to check it, or they explicitly ask for the answer key.
- If the course perspective is not "neutral", teach primarily from that tradition while noting other views when relevant. If neutral, present major views fairly.
- Use plain Markdown: short paragraphs, **bold** for key terms, "- " bullets. No headings above ###.
- Be concise unless the learner asks for depth.`;

function formatLesson(ctx: LearnChatContext): string {
  const lesson = ctx.lesson;
  if (!lesson) return "";
  const parts = [
    `Lesson ${lesson.order}: ${lesson.title} (~${lesson.estimatedMinutes} min)`,
    lesson.kind === "gap"
      ? "This is a practice lesson for missed ideas. Scripture and historical sources below were retrieved from the library."
      : "",
    lesson.objectives.length ? `Objectives:\n${lesson.objectives.map((o) => `- ${o}`).join("\n")}` : "",
    lesson.teaching ? `Teaching:\n"""\n${lesson.teaching}\n"""` : "",
    lesson.videos.length
      ? `Videos:\n${lesson.videos
          .map(
            (v) =>
              `- ${v.title}${v.channel ? ` (${v.channel})` : ""} [${v.reviewBasis} review]: ${clip(v.review, 900)}\n  ${v.url}`,
          )
          .join("\n")}`
      : "",
    lesson.articles.length
      ? `Articles:\n${lesson.articles
          .map((a) => `- ${a.title}${a.siteName ? ` · ${a.siteName}` : ""}: ${clip(a.review, 900)}\n  ${a.url}`)
          .join("\n")}`
      : "",
    lesson.books.length
      ? `Books:\n${lesson.books
          .map((b) => `- ${b.title} (${b.authors.join(", ")}): ${clip(b.review, 900)}\n  ${b.url}`)
          .join("\n")}`
      : "",
    lesson.scripture.length
      ? `Scripture (retrieved from the library):\n${lesson.scripture
          .map((s) => `- ${s.reference}: ${clip(s.text, 2000)}${s.note ? `\n  Note: ${s.note}` : ""}`)
          .join("\n\n")}`
      : "",
    lesson.library?.length
      ? `Confessions, commentaries, and church fathers (retrieved from the library):\n${lesson.library
          .map(
            (item) =>
              `- ${item.label}${item.condemned ? " [condemned]" : ""}${item.detail ? ` (${item.detail})` : ""}: ${clip(item.text, 1500)}`,
          )
          .join("\n\n")}`
      : "",
    lesson.quiz.length
      ? `Quiz (questions only — do not reveal answers unprompted):\n${lesson.quiz
          .map((q, i) => {
            const choices = q.choices?.length ? `\n  Choices: ${q.choices.join(" | ")}` : "";
            return `${i + 1}. [${q.kind}] ${q.question}${choices}${q.sourceRef ? ` (ties to: ${q.sourceRef})` : ""}`;
          })
          .join("\n")}`
      : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

function formatRetrieved(lesson: SerializedLesson): string {
  const scripture = lesson.scripture.length
    ? `Scripture (retrieved from the library):\n${lesson.scripture
        .map((s) => `- ${s.reference}: ${clip(s.text, 2000)}`)
        .join("\n\n")}`
    : "";
  const library = lesson.library?.length
    ? `Confessions, commentaries, and church fathers (retrieved from the library):\n${lesson.library
        .map(
          (item) =>
            `- ${item.label}${item.condemned ? " [condemned]" : ""}${item.detail ? ` (${item.detail})` : ""}: ${clip(item.text, 1500)}`,
        )
        .join("\n\n")}`
    : "";
  return [scripture, library].filter(Boolean).join("\n\n");
}

function formatReview(ctx: LearnChatContext): string {
  const review = ctx.review;
  if (!review) return "";
  const retrieved = review.lesson ? formatRetrieved(review.lesson) : "";
  return [
    "Current review item. The question comes from the teach-time quiz bank. Do not reveal the answer unless the learner asks for it.",
    `Concept: ${review.conceptLabel}`,
    `Question: ${review.question}`,
    review.lesson?.kind === "gap" ? "The source is a practice lesson." : "",
    retrieved || "No retrieved scripture or historical source is in the context for this item. Do not supply that wording.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildContextBlock(ctx: LearnChatContext): string {
  const focusLine = ctx.review
    ? `Current focus: Review — ${ctx.review.conceptLabel}`
    : ctx.focus.screen === "lesson" && ctx.focus.lessonTitle
      ? `Current focus: Lesson ${ctx.focus.lessonOrder ?? "?"} — ${ctx.focus.lessonTitle}`
      : ctx.focus.screen === "final"
        ? "Current focus: Final assessment (whole course)"
        : "Current focus: Course overview";

  const parts = [
    `Course: ${ctx.title}`,
    `Topic: ${ctx.topic}`,
    `Complexity: ${ctx.complexity} · Perspective: ${ctx.perspective}`,
    focusLine,
    ctx.objectives.length ? `Course objectives:\n${ctx.objectives.map((o) => `- ${o}`).join("\n")}` : "",
    ctx.prerequisites.length ? `Prerequisites:\n${ctx.prerequisites.map((p) => `- ${p}`).join("\n")}` : "",
    ctx.courseBooks?.length
      ? `Course reading list:\n${ctx.courseBooks
          .map((b) => `- ${b.title} (${b.authors.join(", ")}): ${clip(b.review, 600)}`)
          .join("\n")}`
      : "",
    ctx.lessonOutline?.length
      ? `Lesson map:\n${ctx.lessonOutline.map((l) => `- Lesson ${l.order}: ${l.title}`).join("\n")}`
      : "",
    ctx.finalQuestions?.length
      ? `Final assessment questions:\n${ctx.finalQuestions.map((q, i) => `${i + 1}. [${q.kind}] ${q.question}`).join("\n")}`
      : "",
    formatReview(ctx),
    formatLesson(ctx),
  ];
  return parts.filter(Boolean).join("\n\n");
}

function parseSseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const json = JSON.parse(payload) as {
      type?: string;
      stop_reason?: string;
      delta?: { type?: string; text?: string; stop_reason?: string };
      response?: unknown;
      choices?: { delta?: { content?: unknown } }[];
    };
    warnIfMaxTokensStop(json, "tutor");
    if (json.type === "content_block_delta" && json.delta?.type === "text_delta" && typeof json.delta.text === "string") {
      return json.delta.text;
    }
    if (typeof json.response === "string") return json.response;
    const content = json.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

function textStreamFrom(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const delta = parseSseLine(line);
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      },
      flush(controller) {
        const delta = parseSseLine(buffer);
        if (delta) controller.enqueue(encoder.encode(delta));
      },
    }),
  );
}

function onceText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

type ChatEnv = Pick<LlmEnv, "AI" | "AI_GATEWAY_ID" | "AI_GATEWAY_TOKEN" | "ANTHROPIC_API_KEY" | "LEARN_MODEL_WORKER"> & {
  BIBLE?: D1Database;
  LIBRARY_VECTORS?: VectorizeIndex;
};

type TutorPack = {
  scripture: { reference: string; text: string }[];
  library: { label: string; detail?: string; text: string }[];
};

const emptyTutorPack = (): TutorPack => ({ scripture: [], library: [] });

async function retrieveTutorSources(env: ChatEnv, input: LearnChatInput): Promise<TutorPack> {
  if (!env.BIBLE) return emptyTutorPack();
  const question = [...(input.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";
  const lesson = input.context.lesson;
  const blob = [question, input.context.topic, lesson?.title ?? "", lesson?.teaching ?? "", ...(lesson?.scripture.map((row) => row.reference) ?? [])].join("\n");
  const focus = retrievalFocus(blob);
  const seen = new Set<string>();
  const refs: ReturnType<typeof findBibleReferences> = [];
  for (const text of [...focus.refs, question, ...(lesson?.scripture.map((row) => row.reference) ?? [])]) {
    for (const ref of findBibleReferences(text)) {
      const key = `${ref.book.slug}:${ref.chapter}:${ref.verseStart}:${ref.verseEnd ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
      if (refs.length >= 4) break;
    }
    if (refs.length >= 4) break;
  }
  const loaded = refs.length
    ? await fetchPassagesFromD1(
        env.BIBLE,
        refs.map((ref) => ({ slug: ref.book.slug, chapter: ref.chapter, verseStart: ref.verseStart, verseEnd: ref.verseEnd })),
      ).catch(() => [])
    : [];
  const scripture = loaded.flatMap((passage, index) => {
    const ref = refs[index];
    const text = passage?.verses.map((verse) => verse.text).join(" ").trim() ?? "";
    if (!ref || !text) return [];
    return [{ reference: passage?.reference || ref.label, text: clip(text, 900) }];
  });
  const perspective = isPerspective(input.context.perspective) ? input.context.perspective : "neutral";
  const cited = await citeLibrary(
    env,
    [question, lesson?.title ?? "", ...focus.terms].filter(Boolean).join(". "),
    scripture.map((row) => row.reference),
    perspective,
  ).catch(() => ({ citations: [], dropped: [] }));
  return {
    scripture,
    library: cited.citations.slice(0, 3).map((item) => ({
      label: item.label,
      detail: item.detail,
      text: clip(item.text, 700),
    })),
  };
}

function formatTutorRetrieval(pack: TutorPack): string {
  if (!pack.scripture.length && !pack.library.length) return "";
  const scripture = pack.scripture.map((row) => `- ${row.reference}: ${row.text}`).join("\n\n");
  const library = pack.library.map((row) => `- ${row.label}${row.detail ? ` (${row.detail})` : ""}: ${row.text}`).join("\n\n");
  return [
    "RETRIEVED FOR THIS QUESTION (quote only this wording, and cite each reference you use):",
    scripture ? `Scripture:\n${scripture}` : "",
    library ? `Library:\n${library}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function citationFooter(pack: TutorPack): string {
  const lines = [
    ...pack.scripture.map((row) => `- ${row.reference}`),
    ...pack.library.map((row) => `- ${row.label}${row.detail ? ` (${row.detail})` : ""}`),
  ];
  return lines.length ? `\n\n**Sources**\n${lines.join("\n")}` : "";
}

function appendText(stream: ReadableStream<Uint8Array>, extra: string): ReadableStream<Uint8Array> {
  if (!extra) return stream;
  const tail = new TextEncoder().encode(extra);
  const out = new TransformStream<Uint8Array, Uint8Array>({
    flush(controller) {
      controller.enqueue(tail);
    },
  });
  return stream.pipeThrough(out);
}

export async function streamLearnChat(env: ChatEnv, input: LearnChatInput): Promise<ReadableStream<Uint8Array>> {
  const history = (input.messages ?? [])
    .filter((m): m is LearnChatMessage => (m.role === "user" || m.role === "assistant") && !!m.content?.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: clip(m.content, 4000) }));

  if (!history.length || history.at(-1)?.role !== "user") {
    throw new Error("messages must end with a user turn");
  }

  const retrieved = await retrieveTutorSources(env, input).catch(() => emptyTutorPack());
  const retrievedBlock = formatTutorRetrieval(retrieved);
  const system = `${SYSTEM}\n\n${buildContextBlock(input.context)}${retrievedBlock ? `\n\n${retrievedBlock}` : ""}`;
  const model = learnModelId(env, "worker");
  const footer = citationFooter(retrieved);

  if (model.startsWith("anthropic/")) {
    const result = await callAnthropic(env, model, {
      max_tokens: LEARN_MAX_TOKENS,
      stream: true,
      system,
      messages: history,
    });
    if (typeof Response !== "undefined" && result instanceof Response) {
      if (!result.ok || !result.body) {
        const detail = (await result.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500);
        throw new Error(`Anthropic via gateway: ${result.status}${detail ? ` ${detail}` : ""}`);
      }
      return appendText(textStreamFrom(result.body), footer);
    }
    return onceText(`${await readAnthropicText(result, "tutor")}${footer}`);
  }

  const upstream = (await runWorkersAi(
    env.AI,
    model,
    {
      messages: [{ role: "system", content: system }, ...history],
      stream: true,
      max_tokens: LEARN_MAX_TOKENS,
      reasoning_effort: LEARN_THINKING_EFFORT,
      temperature: 0.45,
    },
    workersGatewayCall(env.AI_GATEWAY_ID, { stage: "chat" }),
  )) as unknown as ReadableStream<Uint8Array>;

  return appendText(textStreamFrom(upstream), footer);
}

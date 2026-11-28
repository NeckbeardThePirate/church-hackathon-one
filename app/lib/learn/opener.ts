/**
 * Opener diagnostic: a short, sequential, skippable check that runs while a path is built.
 * Question generation is a model call. Everything here is pure so a timeout, a skip,
 * or a bad model payload cannot stall the path.
 */

export const OPENER_MIN_QUESTIONS = 3;
export const OPENER_MAX_QUESTIONS = 4;
/** A generation lock older than this is abandoned so a dropped request cannot stick. */
export const OPENER_LOCK_MS = 25_000;

export type OpenerReading = "strength" | "gap" | "unsure";
export type OpenerCloseReason = "complete" | "skipped" | "unavailable";

export type OpenerChoice = {
  id: string;
  label: string;
  reading: OpenerReading;
  concept: string;
};

export type OpenerQuestion = {
  id: string;
  prompt: string;
  probe: string;
  stop: boolean;
  choices: OpenerChoice[];
};

/** Model payload before the server assigns a stable id. */
export type OpenerQuestionDraft = Omit<OpenerQuestion, "id">;

export type OpenerAnswer = {
  questionId: string;
  choiceId: string;
};

export type OpenerDiagnostic = {
  strengths: string[];
  gaps: string[];
};

export type OpenerState = {
  status: "open" | "closed";
  reason?: OpenerCloseReason;
  questions: OpenerQuestion[];
  answers: OpenerAnswer[];
  diagnostic: OpenerDiagnostic;
  generating: boolean;
  generatingSince?: number;
};

export type OpenerAction =
  | { type: "next" }
  | { type: "answer"; questionId: string; choiceId: string }
  | { type: "skip" };

export type OpenerEvent =
  | { type: "start" }
  | { type: "generated"; question: OpenerQuestionDraft }
  | { type: "answer"; questionId: string; choiceId: string }
  | { type: "skip" }
  | { type: "fail" };

export type OpenerEffect =
  | { type: "show" }
  | { type: "generate" }
  | { type: "steer" }
  | { type: "close" }
  | { type: "busy" };

export type OpenerPublicQuestion = {
  id: string;
  prompt: string;
  choices: { id: string; label: string }[];
};

export type OpenerPublic = {
  status: "ready" | "asking" | "closed";
  reason?: OpenerCloseReason;
  question?: OpenerPublicQuestion;
  index: number;
  answered: number;
  limit: number;
  pending?: boolean;
  summary?: string;
};

export type AdaptableLesson = {
  id: string;
  order: number;
  title: string;
  objectives: string[];
  prerequisiteLessonIds: string[];
  estimatedMinutes: number;
  searchHints: string[];
  pending: boolean;
  started: boolean;
};

export type AdaptationBand = { min: number; max: number; minutes: number };

export type OutlineAdaptation = {
  lessons: AdaptableLesson[];
  dropIds: string[];
  addIds: string[];
  focusIds: string[];
  note: string;
};

/** What the path builder should enqueue after an opener answer. The check itself never throws. */
export type OpenerSteer = {
  researchIds: string[];
  critic: boolean;
  round: number;
};

export function freshOpener(): OpenerState {
  return {
    status: "open",
    questions: [],
    answers: [],
    diagnostic: { strengths: [], gaps: [] },
    generating: false,
  };
}

export function normalizeOpenerState(value: unknown): OpenerState {
  const fresh = freshOpener();
  if (!value || typeof value !== "object") return fresh;
  const raw = value as Partial<OpenerState>;
  const diagnostic = raw.diagnostic;
  const reason = raw.reason === "complete" || raw.reason === "skipped" || raw.reason === "unavailable" ? raw.reason : undefined;
  return {
    status: raw.status === "closed" ? "closed" : "open",
    ...(raw.status === "closed" ? { reason: reason ?? "complete" } : reason ? { reason } : {}),
    questions: Array.isArray(raw.questions) ? raw.questions.filter(isQuestion) : [],
    answers: Array.isArray(raw.answers) ? raw.answers.filter(isAnswer) : [],
    diagnostic: {
      strengths: stringList(diagnostic?.strengths),
      gaps: stringList(diagnostic?.gaps),
    },
    generating: raw.generating === true,
    ...(typeof raw.generatingSince === "number" ? { generatingSince: raw.generatingSince } : {}),
  };
}

export function parseOpenerAction(body: unknown): { ok: true; action: OpenerAction } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Missing opener action." };
  const raw = body as Record<string, unknown>;
  if (raw.action === "next" || raw.action === "skip") return { ok: true, action: { type: raw.action } };
  if (raw.action === "answer") {
    const questionId = typeof raw.questionId === "string" ? raw.questionId.trim() : "";
    const choiceId = typeof raw.choiceId === "string" ? raw.choiceId.trim() : "";
    if (!questionId) return { ok: false, error: "Missing question." };
    if (!choiceId) return { ok: false, error: "Missing choice." };
    return { ok: true, action: { type: "answer", questionId, choiceId } };
  }
  return { ok: false, error: "Unknown opener action." };
}

function readingOf(value: unknown, label: string): OpenerReading | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "strength" || text === "strong") return "strength";
  if (text === "gap" || text === "weak" || text === "missing") return "gap";
  if (text === "unsure" || text === "unknown" || text === "not sure" || text === "not-sure") return "unsure";
  if (/not sure|unsure|don'?t know|do not know/i.test(label)) return "unsure";
  return null;
}

/** The example that used to ship in the prompt. A copied answer must not steer the path. */
export function isPlaceholderConcept(value: string): boolean {
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return true;
  if (/^<[^>]+>$/.test(key)) return true;
  if (/\bmain idea\b/.test(key)) return true;
  if (/\bnearby idea\b/.test(key)) return true;
  return false;
}

export function promptsRepeat(left: string, right: string): boolean {
  return left.trim().toLowerCase().replace(/\s+/g, " ") === right.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Validate one model question. Throws so the caller can retry or close the check. */
export function parseOpenerQuestion(value: unknown): OpenerQuestionDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("opener question must be an object");
  const raw = value as Record<string, unknown>;
  const prompt = clipText(raw.prompt, 400);
  const probe = clipText(raw.probe, 80);
  if (!prompt) throw new Error("prompt must be a non-empty string");
  if (!probe) throw new Error("probe must be a non-empty string");
  if (!Array.isArray(raw.choices)) throw new Error("choices must be an array");
  const choices: OpenerChoice[] = [];
  const seen = new Set<string>();
  for (const item of raw.choices) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = clipText(row.id, 24);
    const label = clipText(row.label, 160);
    const concept = clipText(row.concept, 80) || probe;
    const reading = readingOf(row.reading, label);
    if (!id || !label || !reading || seen.has(id)) continue;
    seen.add(id);
    choices.push({ id, label, reading, concept });
    if (choices.length === 4) break;
  }
  if (!choices.some((choice) => choice.reading === "unsure") && choices.length < 4) {
    const id = seen.has("unsure") ? "not-sure" : "unsure";
    choices.push({ id, label: "I'm not sure yet", reading: "unsure", concept: probe });
  }
  if (choices.length < 3) throw new Error("choices need at least 3 items");
  if (isPlaceholderConcept(probe) || choices.some((choice) => choice.reading !== "unsure" && isPlaceholderConcept(choice.concept))) {
    throw new Error('name a specific idea from the topic or passage, not "the main idea" or "a nearby idea"');
  }
  if (/how familiar is the main idea\??$/i.test(prompt)) {
    throw new Error('name a specific idea from the topic or passage, not "the main idea"');
  }
  return { prompt, probe, stop: raw.stop === true, choices };
}

const FALLBACK_ANGLES = [
  (idea: string) => `How familiar is ${idea}?`,
  (idea: string) => `What still feels unclear about ${idea}?`,
  (idea: string) => `Could you explain ${idea} without looking it up?`,
  (idea: string) => `Where do you want more help with ${idea}?`,
];

/**
 * A question built from the topic, the passage, and the outline when the model
 * does not return a specific one. Never uses the placeholder example.
 */
export function fallbackOpenerQuestion(input: {
  topic: string;
  references: string[];
  concepts: string[];
  asked: string[];
}): OpenerQuestionDraft {
  const asked = new Set(input.asked.map((item) => conceptKey(item)));
  const pool = uniqueConcepts([...input.concepts, ...input.references, input.topic]);
  const idea = pool.find((item) => !asked.has(conceptKey(item))) ?? pool[0] ?? "this passage";
  const other = pool.find((item) => conceptKey(item) !== conceptKey(idea));
  const mix = other ?? "another part of this passage";
  const angle = FALLBACK_ANGLES[Math.min(input.asked.length, FALLBACK_ANGLES.length - 1)] ?? FALLBACK_ANGLES[0]!;
  return {
    prompt: angle(idea),
    probe: clipText(idea, 80),
    stop: false,
    choices: [
      { id: "a", label: `I can explain ${idea}`, reading: "strength", concept: idea },
      { id: "b", label: `I have only heard of ${idea}`, reading: "gap", concept: idea },
      { id: "c", label: `I mix ${idea} up with ${mix}`, reading: "gap", concept: mix === idea ? idea : mix },
      { id: "d", label: "I'm not sure yet", reading: "unsure", concept: idea },
    ],
  };
}

function uniqueConcepts(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const label = value.trim().replace(/\s+/g, " ");
    if (!label || isPlaceholderConcept(label)) continue;
    const key = conceptKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function unansweredQuestion(state: OpenerState): OpenerQuestion | undefined {
  return state.questions.find((question) => !state.answers.some((answer) => answer.questionId === question.id));
}

/**
 * One step of the check. `skip` always closes. `fail` closes unless a question is already waiting.
 * A stop flag is ignored until the minimum number of answers is in.
 */
export function reduceOpener(state: OpenerState, event: OpenerEvent): { state: OpenerState; effects: OpenerEffect[] } {
  if (event.type === "fail") {
    if (state.status === "closed") return { state: unlock(state), effects: [] };
    // A question that landed just as the wait expired must not be thrown away.
    if (unansweredQuestion(state)) return { state: unlock(state), effects: [{ type: "show" }] };
    return { state: closeOpener(state, state.answers.length ? "complete" : "unavailable"), effects: [{ type: "steer" }, { type: "close" }] };
  }
  if (event.type === "skip") {
    if (state.status === "closed") return { state, effects: [] };
    return { state: closeOpener(state, "skipped"), effects: [{ type: "steer" }, { type: "close" }] };
  }
  if (state.status === "closed") {
    // A failed first question must not end the check. The next request starts it again.
    // Skip and a finished diagnostic stay closed.
    if (event.type === "start" && state.reason === "unavailable" && state.answers.length === 0) {
      return reduceOpener(freshOpener(), event);
    }
    return { state, effects: [] };
  }

  if (event.type === "start") {
    if (unansweredQuestion(state)) return { state, effects: [{ type: "show" }] };
    if (!shouldContinue(state)) return { state: closeOpener(state, state.answers.length ? "complete" : "unavailable"), effects: [{ type: "close" }] };
    return { state, effects: [{ type: "generate" }] };
  }

  if (event.type === "generated") {
    if (unansweredQuestion(state) || state.questions.length >= OPENER_MAX_QUESTIONS) {
      return { state, effects: [{ type: "show" }] };
    }
    const question: OpenerQuestion = { ...event.question, id: `q${state.questions.length + 1}` };
    return { state: { ...state, questions: [...state.questions, question] }, effects: [{ type: "show" }] };
  }

  const question = state.questions.find((item) => item.id === event.questionId);
  if (!question || state.answers.some((answer) => answer.questionId === question.id)) {
    if (unansweredQuestion(state)) return { state, effects: [{ type: "show" }] };
    if (shouldContinue(state)) return { state, effects: [{ type: "generate" }] };
    return { state: closeOpener(state, state.answers.length ? "complete" : "unavailable"), effects: [{ type: "close" }] };
  }
  const choice = question.choices.find((item) => item.id === event.choiceId);
  if (!choice) return { state, effects: [{ type: "show" }] };

  const next: OpenerState = {
    ...state,
    answers: [...state.answers, { questionId: question.id, choiceId: choice.id }],
    diagnostic: applyReading(state.diagnostic, choice.concept || question.probe, choice.reading),
  };
  if (shouldContinue(next)) return { state: next, effects: [{ type: "steer" }, { type: "generate" }] };
  return { state: closeOpener(next, "complete"), effects: [{ type: "steer" }, { type: "close" }] };
}

/** Claim a model turn without letting two requests generate the same question. */
export function beginOpenerTurn(state: OpenerState, event: OpenerEvent, now: number): { state: OpenerState; effects: OpenerEffect[] } {
  const current = clearStaleLock(state, now);
  if (event.type === "start" && current.generating) return { state: current, effects: [{ type: "busy" }] };
  const reduced = reduceOpener(current, event);
  const generate = reduced.effects.some((effect) => effect.type === "generate");
  return {
    state: generate ? { ...reduced.state, generating: true, generatingSince: now } : { ...reduced.state, generating: false, generatingSince: undefined },
    effects: reduced.effects,
  };
}

export function commitGeneratedQuestion(state: OpenerState, question: OpenerQuestionDraft): OpenerState {
  const reduced = reduceOpener(unlock(state), { type: "generated", question });
  return { ...reduced.state, generating: false, generatingSince: undefined };
}

export function commitOpenerFailure(state: OpenerState): { state: OpenerState; effects: OpenerEffect[] } {
  const reduced = reduceOpener(unlock(state), { type: "fail" });
  return { state: { ...reduced.state, generating: false, generatingSince: undefined }, effects: reduced.effects };
}

export type OpenerStep = "show" | "wait" | "done";

/**
 * What the check card should do with one payload.
 * A missing question, or a close before any answer, is not the end of the check.
 * Skip and a finished diagnostic are.
 */
export function openerStep(
  body: Pick<OpenerPublic, "status" | "reason" | "question" | "answered"> | null | undefined,
): OpenerStep {
  if (!body) return "wait";
  if (body.status === "asking" && body.question) return "show";
  if (body.status === "closed" && !(body.reason === "unavailable" && body.answered === 0)) return "done";
  return "wait";
}

export function presentOpener(state: OpenerState, pending = false): OpenerPublic {
  const limit = OPENER_MAX_QUESTIONS;
  if (state.status === "closed") {
    return {
      status: "closed",
      reason: state.reason ?? "complete",
      index: state.answers.length,
      answered: state.answers.length,
      limit,
      summary: openerSummary(state.diagnostic),
    };
  }
  const question = unansweredQuestion(state);
  if (!question) {
    return {
      status: "ready",
      pending,
      index: state.answers.length + 1,
      answered: state.answers.length,
      limit,
    };
  }
  return {
    status: "asking",
    question: {
      id: question.id,
      prompt: question.prompt,
      choices: question.choices.map((choice) => ({ id: choice.id, label: choice.label })),
    },
    index: state.questions.findIndex((item) => item.id === question.id) + 1,
    answered: state.answers.length,
    limit,
  };
}

function concreteConcepts(values: string[]): string[] {
  return values.map((item) => item.trim()).filter((item) => item && !isPlaceholderConcept(item));
}

export function openerSummary(diagnostic: OpenerDiagnostic): string {
  const gaps = concreteConcepts(diagnostic.gaps).slice(0, 3);
  const strengths = concreteConcepts(diagnostic.strengths).slice(0, 3);
  if (gaps.length && strengths.length) {
    return `Your path will lean into ${phrase(gaps)}, with ${phrase(strengths)} treated as familiar.`;
  }
  if (gaps.length) return `Your path will lean into ${phrase(gaps)}.`;
  if (strengths.length) return `Your path will move ahead where ${phrase(strengths)} is already familiar.`;
  return "";
}

export function diagnosticBrief(diagnostic: OpenerDiagnostic): string {
  const strengths = concreteConcepts(diagnostic.strengths);
  const gaps = concreteConcepts(diagnostic.gaps);
  if (!strengths.length && !gaps.length) return "";
  const lines = ["Opener check (answered while this path was being built):"];
  if (strengths.length) lines.push(`Already familiar: ${strengths.join("; ")}.`);
  if (gaps.length) lines.push(`Gaps to teach: ${gaps.join("; ")}.`);
  return lines.join("\n");
}

export function scopeSteerLine(diagnostic: OpenerDiagnostic): string {
  const brief = diagnosticBrief(diagnostic);
  if (!brief) return "";
  return `${brief}\nIf several gaps are listed, prefer a lesson count toward the top of the band. If the learner is already familiar and the gaps are few, prefer the bottom of the band.`;
}

export function planSteerLine(diagnostic: OpenerDiagnostic, lessonCount: number): string {
  const brief = diagnosticBrief(diagnostic);
  if (!brief) return "";
  return `${brief}\nDo not give a familiar concept its own lesson. Spend the ${lessonCount} lesson slots on the gaps. Still return exactly ${lessonCount} lessons.`;
}

export function openerUserPrompt(input: {
  topic: string;
  notes: string;
  passages: { reference: string; text: string }[];
  concepts?: string[];
  questions: OpenerQuestion[];
  answers: OpenerAnswer[];
}): string {
  const lines = [
    `Topic: ${input.topic.trim() || "Study"}`,
    `This is question ${input.answers.length + 1} of at most ${OPENER_MAX_QUESTIONS}.`,
    `Ask about one specific idea from the topic or the passage. Do not say "the main idea" or "a nearby idea".`,
  ];
  const notes = input.notes.trim();
  if (notes) lines.push(`Learner notes:\n"""\n${clipBody(notes, 400)}\n"""`);
  const passages = input.passages.slice(0, 4).filter((passage) => passage.reference.trim());
  if (passages.length) {
    lines.push(
      `Passages the learner chose (do not ask them to recite the wording):\n${passages
        .map((passage) => {
          const text = passage.text.trim();
          return text ? `- ${passage.reference}: ${clipBody(text, 800)}` : `- ${passage.reference}`;
        })
        .join("\n")}`,
    );
  }
  const concepts = uniqueConcepts(input.concepts ?? []);
  if (concepts.length) {
    lines.push(`Ideas already on this path. Prefer one that has not been asked:\n${concepts.slice(0, 8).map((concept) => `- ${concept}`).join("\n")}`);
  }
  const asked = uniqueConcepts(input.questions.map((question) => question.probe));
  if (asked.length) lines.push(`Already asked. Choose a different idea:\n${asked.map((concept) => `- ${concept}`).join("\n")}`);
  if (input.answers.length) {
    const prior = input.answers.map((answer, index) => {
      const question = input.questions.find((item) => item.id === answer.questionId);
      const choice = question?.choices.find((item) => item.id === answer.choiceId);
      const reading = choice?.reading === "strength" ? "familiar" : choice?.reading === "gap" ? "gap" : "unsure";
      return `${index + 1}. ${question?.prompt ?? "Question"} Chose: ${choice?.label ?? answer.choiceId} (${reading} with ${choice?.concept ?? question?.probe ?? "the topic"}).`;
    });
    lines.push(`Earlier answers:\n${prior.join("\n")}`);
  }
  return lines.join("\n\n");
}

/**
 * Drop lessons the learner already knows, and aim the outline at the gaps.
 * Started lessons stay. The result never falls below the band minimum or rises above the maximum.
 * A second call with the same diagnostic and the returned lessons is a no-op.
 */
export function planAdaptation(
  lessons: readonly AdaptableLesson[],
  diagnostic: OpenerDiagnostic,
  band: AdaptationBand,
): OutlineAdaptation {
  const strengths = concreteConcepts(diagnostic.strengths);
  const gaps = concreteConcepts(diagnostic.gaps);
  if (!strengths.length && !gaps.length) {
    return { lessons: [...lessons], dropIds: [], addIds: [], focusIds: [], note: "" };
  }

  const floor = Math.max(1, band.min);
  const ceiling = Math.max(floor, band.max);
  const known = lessons.filter(
    (lesson) => lesson.pending && !lesson.started && strengths.some((concept) => coversConcept(lesson, concept)) && !gaps.some((concept) => coversConcept(lesson, concept)),
  );
  const drop = new Set<string>();
  let kept = lessons.length;
  for (const lesson of [...known].sort((a, b) => b.order - a.order)) {
    if (kept - 1 < floor) break;
    drop.add(lesson.id);
    kept -= 1;
  }

  const retargets = new Map<string, AdaptableLesson>();
  const added: AdaptableLesson[] = [];
  let rows = lessons.filter((lesson) => !drop.has(lesson.id));
  const stillKnown = known.filter((lesson) => !drop.has(lesson.id));
  const uncovered = gaps.filter((concept) => ![...rows, ...added].some((lesson) => coversConcept(retargets.get(lesson.id) ?? lesson, concept)));

  const focusGaps: string[] = [];
  for (const concept of gaps) {
    if (!uncovered.includes(concept)) continue;
    const host = stillKnown.find((lesson) => !retargets.has(lesson.id));
    if (host) {
      retargets.set(host.id, retargetLesson(host, concept, band.minutes));
      continue;
    }
    if (rows.length + added.length < ceiling) {
      const previous = added.at(-1) ?? rows.at(-1);
      const lesson = addedLesson(concept, [...lessons, ...added], previous?.id, band.minutes);
      added.push(lesson);
      continue;
    }
    focusGaps.push(concept);
  }

  const focusHost = focusGaps.length
    ? [...rows].reverse().find((lesson) => lesson.pending && !lesson.started && !retargets.has(lesson.id))
    : undefined;
  const focused = focusHost ? focusLesson(focusHost, focusGaps) : null;
  const focusIds = focusHost ? [focusHost.id] : [];

  if (!drop.size && !added.length && !retargets.size && !focused) {
    return { lessons: [...lessons], dropIds: [], addIds: [], focusIds: [], note: "" };
  }

  let next = rows.map((lesson) => retargets.get(lesson.id) ?? lesson);
  next = [...next, ...added];
  if (focused) {
    const aimed = focused;
    next = next.map((lesson) => (lesson.id === aimed.id ? aimed : lesson));
  }
  const present = new Set(next.map((lesson) => lesson.id));
  next = next.map((lesson, index) => {
    const prerequisiteLessonIds = lesson.prerequisiteLessonIds.filter((id) => present.has(id) && id !== lesson.id);
    const original = lessons.find((item) => item.id === lesson.id);
    const repaired =
      index > 0 && !prerequisiteLessonIds.length && (added.some((item) => item.id === lesson.id) || (original?.prerequisiteLessonIds.length ?? 0) > 0)
        ? [next[index - 1]!.id]
        : prerequisiteLessonIds;
    return { ...lesson, order: index + 1, prerequisiteLessonIds: index === 0 ? [] : repaired };
  });

  const droppedTitles = lessons.filter((lesson) => drop.has(lesson.id)).map((lesson) => lesson.title);
  const addedTitles = added.map((lesson) => lesson.title);
  const retargetNotes = [...retargets.entries()].map(([id, lesson]) => {
    const previous = lessons.find((item) => item.id === id);
    return `replaced “${previous?.title ?? id}” with ${lesson.title}`;
  });
  const focusNote = focused ? [`aimed “${lessons.find((lesson) => lesson.id === focused.id)?.title ?? focused.title}” at ${phrase(focusGaps)}`] : [];
  const parts = [
    droppedTitles.length ? `set aside ${listTitles(droppedTitles)}` : "",
    ...retargetNotes,
    addedTitles.length ? `added ${listTitles(addedTitles)}` : "",
    ...focusNote,
  ].filter(Boolean);

  return {
    lessons: next,
    dropIds: [...drop],
    addIds: added.map((lesson) => lesson.id),
    focusIds: [...new Set([...retargets.keys(), ...focusIds])],
    note: parts.length ? `Shaped by your check: ${parts.join("; ")}.` : "",
  };
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "your",
  "what",
  "how",
  "why",
  "are",
  "was",
  "were",
  "been",
  "being",
  "have",
  "has",
  "had",
  "not",
  "but",
  "its",
  "their",
  "them",
  "then",
  "than",
  "about",
  "explain",
  "describe",
  "identify",
  "define",
  "connect",
  "rest",
  "study",
]);

function coversConcept(lesson: { title: string; objectives: string[] }, concept: string): boolean {
  const needle = tokens(concept);
  if (!needle.length) return false;
  const hay = new Set(tokens(`${lesson.title} ${lesson.objectives.join(" ")}`));
  return needle.every((token) => hay.has(token));
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

function retargetLesson(lesson: AdaptableLesson, concept: string, minutes: number): AdaptableLesson {
  return {
    ...lesson,
    title: asTitle(concept),
    objectives: [`Explain ${concept}`, `Connect ${concept} to the rest of this study`],
    searchHints: [concept, `${concept} explained`].map((hint) => hint.slice(0, 80)).slice(0, 4),
    estimatedMinutes: lesson.estimatedMinutes || minutes,
  };
}

function addedLesson(concept: string, existing: readonly { id: string }[], previousId: string | undefined, minutes: number): AdaptableLesson {
  return {
    id: nextLessonId(existing),
    order: 0,
    title: asTitle(concept),
    objectives: [`Explain ${concept}`, `Connect ${concept} to the rest of this study`],
    prerequisiteLessonIds: previousId ? [previousId] : [],
    estimatedMinutes: minutes,
    searchHints: [concept, `${concept} explained`].map((hint) => hint.slice(0, 80)).slice(0, 4),
    pending: true,
    started: false,
  };
}

function focusLesson(lesson: AdaptableLesson, concepts: string[]): AdaptableLesson {
  const objectives = [...lesson.objectives];
  for (const concept of concepts) {
    const line = `Explain ${concept}`;
    if (objectives.some((objective) => objective.toLowerCase() === line.toLowerCase())) continue;
    if (objectives.length < 4) objectives.push(line);
    else objectives[objectives.length - 1] = line;
  }
  const searchHints = [...concepts, ...lesson.searchHints]
    .map((hint) => hint.trim())
    .filter((hint, index, all) => hint && all.findIndex((item) => item.toLowerCase() === hint.toLowerCase()) === index)
    .slice(0, 4);
  return { ...lesson, objectives, searchHints };
}

function nextLessonId(lessons: readonly { id: string }[]): string {
  let max = 0;
  for (const lesson of lessons) {
    const match = /^l(\d+)$/.exec(lesson.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `l${max + 1}`;
}

function asTitle(concept: string): string {
  const trimmed = concept.trim().replace(/\s+/g, " ").slice(0, 80);
  return trimmed.replace(/^./, (char) => char.toUpperCase());
}

function applyReading(diagnostic: OpenerDiagnostic, concept: string, reading: OpenerReading): OpenerDiagnostic {
  const label = concept.trim().replace(/\s+/g, " ");
  if (!label) return diagnostic;
  if (reading === "strength") {
    return { strengths: pushConcept(diagnostic.strengths, label), gaps: withoutConcept(diagnostic.gaps, label) };
  }
  return { strengths: withoutConcept(diagnostic.strengths, label), gaps: pushConcept(diagnostic.gaps, label) };
}

function pushConcept(list: string[], concept: string): string[] {
  return [...withoutConcept(list, concept), concept];
}

function withoutConcept(list: string[], concept: string): string[] {
  const key = conceptKey(concept);
  return list.filter((item) => conceptKey(item) !== key);
}

function conceptKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function shouldContinue(state: OpenerState): boolean {
  if (state.answers.length >= OPENER_MAX_QUESTIONS) return false;
  if (state.answers.length >= OPENER_MIN_QUESTIONS && lastAnswered(state)?.stop) return false;
  return true;
}

function lastAnswered(state: OpenerState): OpenerQuestion | undefined {
  const id = state.answers.at(-1)?.questionId;
  return id ? state.questions.find((question) => question.id === id) : undefined;
}

function closeOpener(state: OpenerState, reason: OpenerCloseReason): OpenerState {
  return { ...state, status: "closed", reason, generating: false, generatingSince: undefined };
}

function unlock(state: OpenerState): OpenerState {
  return { ...state, generating: false, generatingSince: undefined };
}

function clearStaleLock(state: OpenerState, now: number): OpenerState {
  if (!state.generating) return state;
  if (state.generatingSince == null || now - state.generatingSince > OPENER_LOCK_MS) return unlock(state);
  return state;
}

function phrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function listTitles(titles: string[]): string {
  return titles.map((title) => `“${title}”`).join(", ");
}

function clipText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function clipBody(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function isQuestion(value: unknown): value is OpenerQuestion {
  if (!value || typeof value !== "object") return false;
  const raw = value as OpenerQuestion;
  return typeof raw.id === "string" && typeof raw.prompt === "string" && Array.isArray(raw.choices);
}

function isAnswer(value: unknown): value is OpenerAnswer {
  if (!value || typeof value !== "object") return false;
  const raw = value as OpenerAnswer;
  return typeof raw.questionId === "string" && typeof raw.choiceId === "string";
}

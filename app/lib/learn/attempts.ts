import { newConceptMastery, normalizeLearnProgress, type ConceptMastery, type LearnPlanProgress, type PersistedQuiz } from "./plan-progress.ts";

export type LearnAttemptTarget = "lesson" | "final" | "review";

export type LearnAttemptAnswer = {
  conceptId?: string;
  conceptLabel?: string;
  mcChoice: string | null;
  shortText: string;
  shortSubmitted: boolean;
  correct: boolean | null;
};

export type LearnAttempt = {
  target: LearnAttemptTarget;
  lessonId?: string;
  answers: LearnAttemptAnswer[];
};

/** Answer log stored on the plan. conceptMastery is stored beside it, not copied onto every row. */
export type PlanAttemptRecord = {
  at: number;
  target: LearnAttemptTarget;
  lessonId?: string;
  answers: LearnAttemptAnswer[];
  conceptMastery: Record<string, ConceptMastery>;
};

const CONCEPT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const TARGETS = new Set<LearnAttemptTarget>(["lesson", "final", "review"]);

export type AttemptParseResult = { ok: true; attempt: LearnAttempt } | { ok: false; error: string };

export function parseLearnAttempt(body: unknown): AttemptParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Attempt body must be an object." };
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.target !== "string" || !TARGETS.has(raw.target as LearnAttemptTarget)) {
    return { ok: false, error: "target must be lesson, final, or review." };
  }
  const target = raw.target as LearnAttemptTarget;
  let lessonId: string | undefined;
  if (target === "lesson" || target === "review") {
    if (typeof raw.lessonId !== "string" || raw.lessonId.trim().length === 0 || raw.lessonId.length > 80) {
      return { ok: false, error: "lessonId is required." };
    }
    lessonId = raw.lessonId;
  } else if (raw.lessonId !== undefined && raw.lessonId !== null) {
    if (typeof raw.lessonId !== "string" || raw.lessonId.length > 80) {
      return { ok: false, error: "lessonId is invalid." };
    }
    if (raw.lessonId.length > 0) lessonId = raw.lessonId;
  }
  if (!Array.isArray(raw.answers) || raw.answers.length < 1 || raw.answers.length > 30) {
    return { ok: false, error: "answers must be a list of 1 to 30 items." };
  }
  const answers: LearnAttemptAnswer[] = [];
  for (let i = 0; i < raw.answers.length; i++) {
    const parsed = parseAnswer(raw.answers[i], i);
    if (!parsed.ok) return parsed;
    answers.push(parsed.answer);
  }
  return { ok: true, attempt: { target, ...(lessonId ? { lessonId } : {}), answers } };
}

function parseAnswer(value: unknown, index: number): { ok: true; answer: LearnAttemptAnswer } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `answers[${index}] must be an object.` };
  }
  const raw = value as Record<string, unknown>;
  if (!("mcChoice" in raw) || !("shortText" in raw) || !("shortSubmitted" in raw) || !("correct" in raw)) {
    return { ok: false, error: `answers[${index}] is missing an answer field.` };
  }
  if (raw.mcChoice !== null && (typeof raw.mcChoice !== "string" || raw.mcChoice.length > 1000)) {
    return { ok: false, error: `answers[${index}].mcChoice must be a string or null.` };
  }
  if (typeof raw.shortText !== "string" || raw.shortText.length > 4000) {
    return { ok: false, error: `answers[${index}].shortText must be a string.` };
  }
  if (typeof raw.shortSubmitted !== "boolean") {
    return { ok: false, error: `answers[${index}].shortSubmitted must be a boolean.` };
  }
  if (raw.correct !== null && typeof raw.correct !== "boolean") {
    return { ok: false, error: `answers[${index}].correct must be a boolean or null.` };
  }
  let conceptId: string | undefined;
  if (raw.conceptId !== undefined && raw.conceptId !== null) {
    if (typeof raw.conceptId !== "string" || !CONCEPT_ID.test(raw.conceptId)) {
      return { ok: false, error: `answers[${index}].conceptId must be a short slug.` };
    }
    conceptId = raw.conceptId;
  }
  let conceptLabel: string | undefined;
  if (raw.conceptLabel !== undefined && raw.conceptLabel !== null) {
    if (typeof raw.conceptLabel !== "string" || raw.conceptLabel.length > 200) {
      return { ok: false, error: `answers[${index}].conceptLabel must be a short string.` };
    }
    const trimmed = raw.conceptLabel.trim();
    if (trimmed) conceptLabel = trimmed;
  }
  return {
    ok: true,
    answer: {
      ...(conceptId ? { conceptId } : {}),
      ...(conceptLabel ? { conceptLabel } : {}),
      mcChoice: raw.mcChoice as string | null,
      shortText: raw.shortText,
      shortSubmitted: raw.shortSubmitted,
      correct: raw.correct as boolean | null,
    },
  };
}

/**
 * Store lesson or final answers on the progress record and create conceptMastery
 * rows for concept ids that do not already have one. Existing easiness and dueAt stay put.
 * Review answers are not written over the lesson quiz; the plan attempt log keeps those.
 */
export function applyLearnAttempt(progress: unknown, attempt: LearnAttempt): LearnPlanProgress {
  const next = normalizeLearnProgress(progress);
  const persisted: PersistedQuiz = {
    answers: attempt.answers.map((answer) => ({
      mcChoice: answer.mcChoice,
      shortText: answer.shortText,
      shortSubmitted: answer.shortSubmitted,
      correct: answer.correct,
    })),
  };
  if (attempt.target === "lesson" && attempt.lessonId) {
    next.lessonQuiz = { ...next.lessonQuiz, [attempt.lessonId]: persisted };
  } else if (attempt.target === "final") {
    next.finalQuiz = persisted;
  }
  const conceptMastery = { ...next.conceptMastery };
  for (const answer of attempt.answers) {
    if (!answer.conceptId || conceptMastery[answer.conceptId]) continue;
    conceptMastery[answer.conceptId] = newConceptMastery({
      conceptId: answer.conceptId,
      conceptLabel: answer.conceptLabel?.trim() || answer.conceptId,
      lessonId: attempt.target === "final" ? "final" : (attempt.lessonId ?? ""),
    });
  }
  next.conceptMastery = conceptMastery;
  return next;
}

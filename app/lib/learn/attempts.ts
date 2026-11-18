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

/** Answer log stored on the plan. Mastery is merged in the plan DO, not supplied by the caller. */
export type StoredLearnAttempt = {
  at: number;
  target: LearnAttemptTarget;
  lessonId?: string;
  answers: LearnAttemptAnswer[];
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

function persistedAnswer(answer: LearnAttemptAnswer) {
  return {
    mcChoice: answer.mcChoice,
    shortText: answer.shortText,
    shortSubmitted: answer.shortSubmitted,
    correct: answer.correct,
  };
}

/**
 * Overlay submitted answers by question index.
 * A shorter submission keeps the stored tail. The spec does not say to replace the whole quiz.
 */
export function mergeQuizByIndex(existing: PersistedQuiz | null | undefined, incoming: LearnAttemptAnswer[]): PersistedQuiz {
  const previous = existing?.answers ?? [];
  const answers = [];
  const length = Math.max(previous.length, incoming.length);
  for (let i = 0; i < length; i++) {
    const next = incoming[i];
    answers.push(next ? persistedAnswer(next) : previous[i]!);
  }
  return { answers };
}

/**
 * Plan-DO mastery is the base. A concept that already exists is left untouched,
 * including its scheduling fields. Missing concept ids are initialized.
 */
export function mergeConceptMastery(existing: unknown, attempt: LearnAttempt): Record<string, ConceptMastery> {
  const next = { ...normalizeLearnProgress({ conceptMastery: existing }).conceptMastery };
  for (const answer of attempt.answers) {
    if (!answer.conceptId || next[answer.conceptId]) continue;
    next[answer.conceptId] = newConceptMastery({
      conceptId: answer.conceptId,
      conceptLabel: answer.conceptLabel?.trim() || answer.conceptId,
      lessonId: attempt.target === "final" ? "final" : (attempt.lessonId ?? ""),
    });
  }
  return next;
}

/** "final" is the lesson id stored for final-assessment concepts, so a later review can use it. */
export function attemptLessonError(
  project: { learnPlan?: { lessons?: { id?: string }[] } } | null,
  attempt: LearnAttempt,
): string | null {
  if (attempt.target === "final") return null;
  if (attempt.target === "review" && attempt.lessonId === "final") return null;
  const lessons = project?.learnPlan?.lessons;
  if (!project?.learnPlan || !Array.isArray(lessons) || lessons.length === 0) return null;
  if (attempt.lessonId && lessons.some((lesson) => lesson?.id === attempt.lessonId)) return null;
  return "Unknown lesson.";
}

/**
 * Copy the plan DO's mastery onto progress and merge this attempt's answers into one quiz.
 * Other progress fields are kept. Review attempts do not rewrite a lesson or final quiz.
 */
export function mirrorAttemptOntoProgress(
  progress: unknown,
  attempt: LearnAttempt,
  planMastery: unknown,
): LearnPlanProgress {
  const next = normalizeLearnProgress(progress);
  if (attempt.target === "lesson" && attempt.lessonId) {
    next.lessonQuiz = {
      ...next.lessonQuiz,
      [attempt.lessonId]: mergeQuizByIndex(next.lessonQuiz[attempt.lessonId], attempt.answers),
    };
  } else if (attempt.target === "final") {
    next.finalQuiz = mergeQuizByIndex(next.finalQuiz, attempt.answers);
  }
  next.conceptMastery = normalizeLearnProgress({ conceptMastery: planMastery }).conceptMastery;
  return next;
}

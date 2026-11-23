import {
  newConceptMastery,
  normalizeLearnProgress,
  type ConceptMastery,
  type LearnPlanProgress,
  type PersistedQuiz,
  type PersistedQuizAnswer,
} from "./plan-progress.ts";
import {
  adoptProgressForScope,
  FINAL_LESSON_ID,
  lessonQuizFor,
  scopeConceptMastery,
  withFinalQuiz,
  withLessonQuiz,
  type ProgressScope,
} from "./progress-scope.ts";

export type LearnAttemptTarget = "lesson" | "final" | "review";

export type LearnAttemptAnswer = {
  conceptId?: string;
  conceptLabel?: string;
  mcChoice: string | null;
  shortText: string;
  shortSubmitted: boolean;
  correct: boolean | null;
  /** Semantic score copied from the local quiz so a mirror does not drop partial credit. */
  score?: number;
  /** Set when the learner skipped the card or left it blank. Quality 0. */
  skipped?: boolean;
  /** False when this correct answer follows a miss. Omitted answers are graded from the stored row. */
  firstTry?: boolean;
  /**
   * lastReviewedAt before this answer was applied locally.
   * The server keeps a row that is already newer than this and has the same grade.
   */
  previousReviewedAt?: number | null;
  /** False on a lesson mirror that must not schedule again. Omitted answers are scheduled. */
  applySchedule?: boolean;
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
  /** Path that owns this attempt. Set by the server from the workspace project, not from the body. */
  projectId?: string;
  /** Plan id from the request URL. */
  planId?: string;
  /** Learner zone when stats do not have one yet. The route prefers the stored zone. */
  timeZone?: string;
  /** Workspace mastery, bare or scoped. A newer review wins over the plan row before SM-2 runs. */
  workspaceMastery?: Record<string, ConceptMastery>;
  answers: LearnAttemptAnswer[];
};

/** Same slug rule the teach parser uses, so a tagged item can be submitted. */
export const CONCEPT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const TARGETS = new Set<LearnAttemptTarget>(["lesson", "final", "review"]);

export type AttemptParseResult =
  | { ok: true; attempt: LearnAttempt; timeZone?: string }
  | { ok: false; error: string };

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
  let timeZone: string | undefined;
  if (raw.timeZone !== undefined && raw.timeZone !== null) {
    if (typeof raw.timeZone !== "string" || raw.timeZone.length > 100) {
      return { ok: false, error: "timeZone must be an IANA name." };
    }
    const trimmed = raw.timeZone.trim();
    if (trimmed) timeZone = trimmed;
  }
  return { ok: true, attempt: { target, ...(lessonId ? { lessonId } : {}), answers }, ...(timeZone ? { timeZone } : {}) };
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
  let score: number | undefined;
  if (raw.score !== undefined && raw.score !== null) {
    if (typeof raw.score !== "number" || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > 1) {
      return { ok: false, error: `answers[${index}].score must be a number from 0 to 1.` };
    }
    score = raw.score;
  }
  if (raw.skipped !== undefined && typeof raw.skipped !== "boolean") {
    return { ok: false, error: `answers[${index}].skipped must be a boolean.` };
  }
  if (raw.firstTry !== undefined && typeof raw.firstTry !== "boolean") {
    return { ok: false, error: `answers[${index}].firstTry must be a boolean.` };
  }
  if (raw.applySchedule !== undefined && typeof raw.applySchedule !== "boolean") {
    return { ok: false, error: `answers[${index}].applySchedule must be a boolean.` };
  }
  let previousReviewedAt: number | null | undefined;
  if (raw.previousReviewedAt !== undefined) {
    if (raw.previousReviewedAt === null) previousReviewedAt = null;
    else if (
      typeof raw.previousReviewedAt === "number" &&
      Number.isInteger(raw.previousReviewedAt) &&
      raw.previousReviewedAt >= 0
    ) {
      previousReviewedAt = raw.previousReviewedAt;
    } else {
      return { ok: false, error: `answers[${index}].previousReviewedAt must be a timestamp or null.` };
    }
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
      ...(score !== undefined ? { score } : {}),
      ...(raw.skipped === true ? { skipped: true } : {}),
      ...(raw.firstTry === true || raw.firstTry === false ? { firstTry: raw.firstTry } : {}),
      ...(previousReviewedAt !== undefined ? { previousReviewedAt } : {}),
      ...(raw.applySchedule === true || raw.applySchedule === false ? { applySchedule: raw.applySchedule } : {}),
    },
  };
}

/**
 * A lesson or final quiz is submitted once every item has a right/wrong result.
 * Partial progress stays local. Untagged answers are included and simply omit conceptId.
 */
export function submittedLessonAttempt(
  target: "lesson" | "final",
  lessonId: string,
  answers: LearnAttemptAnswer[],
): LearnAttempt | null {
  if (answers.length < 1 || answers.some((answer) => answer.correct == null)) return null;
  if (target === "lesson") return { target, lessonId, answers };
  return { target, answers };
}

/** Concept ids the learner missed. Untagged wrong answers are skipped; repeats are listed once. */
export function missedConceptIds(attempt: { answers: Pick<LearnAttemptAnswer, "conceptId" | "correct">[] }): string[] {
  const ids: string[] = [];
  for (const answer of attempt.answers) {
    if (answer.correct !== false || !answer.conceptId || ids.includes(answer.conceptId)) continue;
    ids.push(answer.conceptId);
  }
  return ids;
}

function persistedAnswer(answer: LearnAttemptAnswer, previous?: PersistedQuizAnswer): PersistedQuizAnswer {
  const next: PersistedQuizAnswer = {
    mcChoice: answer.mcChoice,
    shortText: answer.shortText,
    shortSubmitted: answer.shortSubmitted,
    correct: answer.correct,
  };
  if (typeof answer.score === "number" && Number.isFinite(answer.score)) {
    next.score = answer.score;
  } else if (
    previous &&
    typeof previous.score === "number" &&
    previous.mcChoice === next.mcChoice &&
    previous.shortText === next.shortText &&
    previous.shortSubmitted === next.shortSubmitted &&
    previous.correct === next.correct
  ) {
    next.score = previous.score;
  }
  return next;
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
    answers.push(next ? persistedAnswer(next, previous[i]) : previous[i]!);
  }
  return {
    answers,
    ...(typeof existing?.bestCorrect === "number" ? { bestCorrect: existing.bestCorrect } : {}),
    ...(existing?.settled === true ? { settled: true } : {}),
  };
}

function highestMasteryRev(mastery: Record<string, ConceptMastery>): number {
  let rev = 0;
  for (const row of Object.values(mastery)) {
    if (typeof row.masteryRev === "number" && row.masteryRev > rev) rev = row.masteryRev;
  }
  return rev;
}

/**
 * Plan-DO mastery is the base. A concept that already exists is left untouched,
 * including its scheduling fields. Missing concept ids are initialized with the next revision.
 * Rows that predate revisions are stamped once so later mirrors can order them.
 */
export function mergeConceptMastery(existing: unknown, attempt: LearnAttempt): Record<string, ConceptMastery> {
  const next = { ...normalizeLearnProgress({ conceptMastery: existing }).conceptMastery };
  let rev = highestMasteryRev(next);
  for (const [id, row] of Object.entries(next)) {
    if (row.masteryRev !== undefined) continue;
    rev += 1;
    next[id] = { ...row, masteryRev: rev };
  }
  for (const answer of attempt.answers) {
    if (!answer.conceptId || next[answer.conceptId]) continue;
    rev += 1;
    next[answer.conceptId] = {
      ...newConceptMastery({
        conceptId: answer.conceptId,
        conceptLabel: answer.conceptLabel?.trim() || answer.conceptId,
        lessonId: attempt.target === "final" ? "final" : (attempt.lessonId ?? ""),
      }),
      masteryRev: rev,
    };
  }
  return next;
}

/**
 * Union two mastery snapshots. A concept only one side has is kept.
 * The same concept keeps the higher masteryRev, so an older plan snapshot cannot
 * erase a concept or roll a row back. Equal revisions keep the row already stored.
 */
export function mergeMasterySnapshots(
  current: Record<string, ConceptMastery>,
  incoming: Record<string, ConceptMastery>,
): Record<string, ConceptMastery> {
  const next = { ...current };
  for (const [id, row] of Object.entries(incoming)) {
    const stored = next[id];
    const incomingRev = row.masteryRev ?? 0;
    const storedRev = stored?.masteryRev ?? 0;
    if (!stored || incomingRev > storedRev) next[id] = row;
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
 * Fold plan-DO mastery into local progress without rewriting quiz answers.
 * Used when the learner has already changed the quiz since the POST left.
 */
export function applyPlanMastery(progress: unknown, planMastery: unknown, scope: ProgressScope): LearnPlanProgress {
  const next = adoptProgressForScope(normalizeLearnProgress(progress), scope);
  const incoming = scopeConceptMastery(normalizeLearnProgress({ conceptMastery: planMastery }).conceptMastery, scope);
  next.conceptMastery = mergeMasterySnapshots(next.conceptMastery, incoming);
  return next;
}

/**
 * Merge this attempt's answers into one quiz and fold the plan snapshot into mastery.
 * The snapshot may be stale. Concepts already on the project are kept, and a lower
 * masteryRev cannot replace a higher one. Other progress fields are kept.
 * Review attempts do not rewrite a lesson or final quiz.
 */
export function mirrorAttemptOntoProgress(
  progress: unknown,
  attempt: LearnAttempt,
  planMastery: unknown,
  scope: ProgressScope,
): LearnPlanProgress {
  let next = adoptProgressForScope(normalizeLearnProgress(progress), scope);
  if (attempt.target === "lesson" && attempt.lessonId) {
    next = withLessonQuiz(
      next,
      scope,
      attempt.lessonId,
      mergeQuizByIndex(lessonQuizFor(next, scope, attempt.lessonId), attempt.answers),
    );
  } else if (attempt.target === "final") {
    next = withFinalQuiz(next, scope, mergeQuizByIndex(lessonQuizFor(next, scope, FINAL_LESSON_ID), attempt.answers));
  }
  const incoming = scopeConceptMastery(normalizeLearnProgress({ conceptMastery: planMastery }).conceptMastery, scope);
  next.conceptMastery = mergeMasterySnapshots(next.conceptMastery, incoming);
  return next;
}

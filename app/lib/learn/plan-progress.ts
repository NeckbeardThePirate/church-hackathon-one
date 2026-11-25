/** Persisted learn course state (per project and plan). */

import {
  adoptProgressForScope,
  duplicateProgressIndexes,
  emptyScopedProgress,
  finalQuizFor,
  hasScopedLearning,
  lessonQuizFor,
  parseProgressKey,
  parseScopeId,
  projectForScope,
  readDoneFor,
  scopeFromProject,
  type ProgressClaimProject,
  type ProgressScope,
} from "./progress-scope.ts";

export type LearnScreen = "overview" | "lesson" | "final";

export type LearnLocation = {
  screen: LearnScreen;
  lessonId?: string;
};

export type PersistedQuizAnswer = {
  mcChoice: string | null;
  shortText: string;
  shortSubmitted: boolean;
  correct: boolean | null;
  /** 0–1 semantic score. Partial credit is below the correct band. */
  score?: number;
};

export type PersistedQuiz = {
  answers: PersistedQuizAnswer[];
  /** Highest number of correct answers kept across retries. */
  bestCorrect?: number;
  /** True once every question has been answered. Trying the quiz again does not clear it. */
  settled?: boolean;
};

/** SM-2 row for one concept. dueAt 0 means unscheduled and is not due. */
export type ConceptMastery = {
  conceptId: string;
  conceptLabel: string;
  lessonId: string;
  easiness: number;
  repetitions: number;
  intervalDays: number;
  dueAt: number;
  lastQuality: number | null;
  lastReviewedAt: number | null;
  correctStreak: number;
  gapPlanId?: string;
  /**
   * Monotonic generation assigned by the plan DO when the row is created or changed.
   * Workspace mirrors keep the higher revision. Absent on rows written before versions existed.
   */
  masteryRev?: number;
};

export type LearnPlanProgress = {
  v: 3;
  /**
   * Set once this blob has been claimed for one path.
   * `projectId` + separator + `planId`. Bare lesson keys are not displayable until then.
   */
  scopeId?: string;
  location: LearnLocation;
  /** Scroll depth 0–100. Keys are `projectId`, `planId`, and lesson id, not the lesson id alone. */
  lessonReadScroll: Record<string, number>;
  lessonReadDone: Record<string, boolean>;
  lessonQuiz: Record<string, PersistedQuiz>;
  /** Legacy single slot. New writes leave this null and store the final under `lessonQuiz`. */
  finalQuiz: PersistedQuiz | null;
  /** Scroll depth 0–100 per article URL, inside the reading window. */
  articleScroll: Record<string, number>;
  /** Explicitly marked complete, keyed by article URL. */
  articleDone: Record<string, boolean>;
  conceptMastery: Record<string, ConceptMastery>;
};

/** New concept row. easiness starts at the SM-2 default; dueAt stays 0 until scheduling exists. */
export function newConceptMastery(input: {
  conceptId: string;
  conceptLabel: string;
  lessonId: string;
}): ConceptMastery {
  return {
    conceptId: input.conceptId,
    conceptLabel: input.conceptLabel,
    lessonId: input.lessonId,
    easiness: 2.5,
    repetitions: 0,
    intervalDays: 0,
    dueAt: 0,
    lastQuality: null,
    lastReviewedAt: null,
    correctStreak: 0,
  };
}

const STORAGE_PREFIX = "learn-progress:";

export function defaultLocation(): LearnLocation {
  return { screen: "overview" };
}

export function emptyLearnProgress(): LearnPlanProgress {
  return {
    v: 3,
    location: defaultLocation(),
    lessonReadScroll: {},
    lessonReadDone: {},
    lessonQuiz: {},
    finalQuiz: null,
    articleScroll: {},
    articleDone: {},
    conceptMastery: {},
  };
}

function numberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out[key] = Math.min(100, Math.max(0, Math.round(raw)));
  }
  return out;
}

function boolMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === true || raw === false) out[key] = raw;
  }
  return out;
}

function finiteMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out[key] = raw;
  }
  return out;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function emptyQuizAnswer(): PersistedQuizAnswer {
  return { mcChoice: null, shortText: "", shortSubmitted: false, correct: null };
}

function parseQuizAnswer(value: unknown): PersistedQuizAnswer {
  if (!value || typeof value !== "object") return emptyQuizAnswer();
  const row = value as Record<string, unknown>;
  const answer: PersistedQuizAnswer = {
    mcChoice: typeof row.mcChoice === "string" ? row.mcChoice : null,
    shortText: typeof row.shortText === "string" ? row.shortText : "",
    shortSubmitted: row.shortSubmitted === true,
    correct: row.correct === true ? true : row.correct === false ? false : null,
  };
  if (typeof row.score === "number" && Number.isFinite(row.score)) {
    answer.score = Math.min(1, Math.max(0, row.score));
  }
  return answer;
}

function parseQuiz(value: unknown): PersistedQuiz | null {
  if (!value || typeof value !== "object") return null;
  const answers = (value as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return null;
  const row = value as { bestCorrect?: unknown; settled?: unknown };
  const bestCorrect =
    typeof row.bestCorrect === "number" && Number.isFinite(row.bestCorrect) ? Math.max(0, Math.round(row.bestCorrect)) : undefined;
  return {
    answers: answers.map((item) => parseQuizAnswer(item)),
    ...(bestCorrect !== undefined ? { bestCorrect } : {}),
    ...(row.settled === true ? { settled: true } : {}),
  };
}

function quizMap(value: unknown): Record<string, PersistedQuiz> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, PersistedQuiz> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const quiz = parseQuiz(raw);
    if (quiz) out[key] = quiz;
  }
  return out;
}

function parseLocation(value: unknown): LearnLocation {
  if (!value || typeof value !== "object") return defaultLocation();
  const raw = value as LearnLocation;
  const screen = raw.screen === "lesson" || raw.screen === "final" || raw.screen === "overview" ? raw.screen : "overview";
  return {
    screen,
    ...(typeof raw.lessonId === "string" ? { lessonId: raw.lessonId } : {}),
  };
}

function normalizeConceptMastery(value: unknown): Record<string, ConceptMastery> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, ConceptMastery> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const scoped = parseProgressKey(key);
    const slugFromRow = typeof row.conceptId === "string" && row.conceptId.trim() && !parseProgressKey(row.conceptId)
      ? row.conceptId
      : "";
    const conceptId = slugFromRow || (scoped ? scoped.rest : key);
    if (!conceptId) continue;
    const storageKey = scoped ? key : conceptId;
    const conceptLabel =
      typeof row.conceptLabel === "string" && row.conceptLabel.trim() ? row.conceptLabel : conceptId;
    const lessonId = typeof row.lessonId === "string" ? (parseProgressKey(row.lessonId)?.rest ?? row.lessonId) : "";
    const mastery: ConceptMastery = {
      ...newConceptMastery({ conceptId, conceptLabel, lessonId }),
      easiness: finiteOr(row.easiness, 2.5),
      repetitions: intOr(row.repetitions, 0),
      intervalDays: intOr(row.intervalDays, 0),
      dueAt: finiteOr(row.dueAt, 0),
      lastQuality: row.lastQuality == null ? null : finiteOr(row.lastQuality, 0),
      lastReviewedAt: row.lastReviewedAt == null ? null : finiteOr(row.lastReviewedAt, 0),
      correctStreak: intOr(row.correctStreak, 0),
    };
    if (typeof row.gapPlanId === "string" && row.gapPlanId) mastery.gapPlanId = row.gapPlanId;
    if (typeof row.masteryRev === "number" && Number.isInteger(row.masteryRev) && row.masteryRev > 0) {
      mastery.masteryRev = row.masteryRev;
    }
    out[storageKey] = mastery;
  }
  return out;
}

function hasModernProgressFields(raw: Record<string, unknown>): boolean {
  if (raw.v === 2 || raw.v === 3) return true;
  for (const key of [
    "lessonQuiz",
    "lessonReadDone",
    "lessonReadScroll",
    "articleScroll",
    "articleDone",
    "finalQuiz",
    "conceptMastery",
    "location",
  ]) {
    if (raw[key] != null) return true;
  }
  return false;
}

function hasLegacyProgressFields(raw: Record<string, unknown>): boolean {
  return "lessonQuizDone" in raw || "lessonViewed" in raw || "finalQuizDone" in raw;
}

/**
 * Upgrade v2, v3, unversioned, or legacy progress to v3.
 * Quiz, read, and article fields already on the payload are kept.
 * Missing conceptMastery becomes an empty map. Existing mastery rows are kept.
 */
export function normalizeLearnProgress(progress: unknown): LearnPlanProgress {
  if (!progress || typeof progress !== "object") return emptyLearnProgress();
  const raw = progress as Record<string, unknown>;
  if (!hasModernProgressFields(raw)) return migrateLegacy(raw);

  const scopeId = parseScopeId(raw.scopeId);
  const next: LearnPlanProgress = {
    v: 3,
    ...(scopeId ? { scopeId } : {}),
    location: parseLocation(raw.location),
    lessonReadScroll: finiteMap(raw.lessonReadScroll),
    lessonReadDone: boolMap(raw.lessonReadDone),
    lessonQuiz: quizMap(raw.lessonQuiz),
    finalQuiz: parseQuiz(raw.finalQuiz),
    articleScroll: numberMap(raw.articleScroll),
    articleDone: boolMap(raw.articleDone),
    conceptMastery: normalizeConceptMastery(raw.conceptMastery),
  };
  if (hasLegacyProgressFields(raw)) {
    const legacy = migrateLegacy(raw);
    for (const [id, done] of Object.entries(legacy.lessonReadDone)) {
      if (next.lessonReadDone[id] === undefined) next.lessonReadDone[id] = done;
    }
  }
  return next;
}

export function emptyQuiz(count: number): PersistedQuiz {
  return { answers: Array.from({ length: count }, emptyQuizAnswer) };
}

export function normalizeQuiz(saved: PersistedQuiz | undefined | null, count: number): PersistedQuiz {
  const flags = quizFlags(saved);
  if (!saved?.answers?.length) return { ...emptyQuiz(count), ...flags };
  if (saved.answers.length === count) return { ...saved, ...flags };
  const next = emptyQuiz(count);
  for (let i = 0; i < Math.min(saved.answers.length, count); i++) {
    next.answers[i] = saved.answers[i]!;
  }
  return { ...next, ...flags };
}

function quizFlags(saved: PersistedQuiz | undefined | null): Pick<PersistedQuiz, "bestCorrect" | "settled"> {
  if (!saved) return {};
  return {
    ...(typeof saved.bestCorrect === "number" ? { bestCorrect: saved.bestCorrect } : {}),
    ...(saved.settled === true ? { settled: true } : {}),
  };
}

/** Clear every answer so the quiz can be taken again. A finished quiz stays finished. */
export function retryMissedQuiz(quiz: PersistedQuiz): PersistedQuiz {
  const bestCorrect = Math.max(quiz.bestCorrect ?? 0, quizCorrectCount(quiz));
  const settled = quiz.settled === true || quizAllAnswered(quiz);
  return {
    answers: quiz.answers.map(() => emptyQuizAnswer()),
    bestCorrect,
    ...(settled ? { settled: true } : {}),
  };
}

export function isQuizSettled(quiz: PersistedQuiz | null | undefined): boolean {
  if (!quiz) return false;
  return quiz.settled === true || quizAllAnswered(quiz);
}

export function quizAllAnswered(quiz: PersistedQuiz): boolean {
  return quiz.answers.length > 0 && quiz.answers.every((a) => a.correct !== null);
}

export function quizCorrectCount(quiz: PersistedQuiz): number {
  return quiz.answers.filter((a) => a.correct === true).length;
}

function migrateLegacy(raw: Record<string, unknown>): LearnPlanProgress {
  const base = emptyLearnProgress();
  const lessonQuizDone =
    raw.lessonQuizDone && typeof raw.lessonQuizDone === "object"
      ? (raw.lessonQuizDone as Record<string, boolean>)
      : {};
  const lessonViewed =
    raw.lessonViewed && typeof raw.lessonViewed === "object"
      ? (raw.lessonViewed as Record<string, boolean>)
      : {};
  for (const [id, done] of Object.entries(lessonQuizDone)) {
    if (done) base.lessonReadDone[id] = true;
  }
  for (const [id, done] of Object.entries(lessonViewed)) {
    if (done) base.lessonReadDone[id] = true;
  }
  if (raw.finalQuizDone === true) {
    base.lessonReadDone["__final__"] = true;
  }
  return base;
}

export function readLearnProgress(projectId: string): LearnPlanProgress {
  if (typeof window === "undefined") return emptyLearnProgress();
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return emptyLearnProgress();
    return normalizeLearnProgress(JSON.parse(raw));
  } catch {
    return emptyLearnProgress();
  }
}

export function writeLearnProgress(projectId: string, progress: LearnPlanProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(progress));
  } catch {
    /* quota */
  }
}

function hasStoredLearning(progress: LearnPlanProgress): boolean {
  return (
    progress.location.screen !== "overview" ||
    Object.keys(progress.lessonReadScroll).length > 0 ||
    Object.keys(progress.lessonReadDone).length > 0 ||
    Object.keys(progress.lessonQuiz).length > 0 ||
    progress.finalQuiz != null ||
    Object.keys(progress.articleScroll).length > 0 ||
    Object.keys(progress.articleDone).length > 0 ||
    Object.keys(progress.conceptMastery).length > 0
  );
}

function unionQuizSlot(remote: PersistedQuiz | null, local: PersistedQuiz | null): PersistedQuiz | null {
  if (!local) return remote;
  if (!remote) return local;
  const length = Math.max(remote.answers.length, local.answers.length);
  const answers = [];
  for (let i = 0; i < length; i++) {
    const saved = remote.answers[i];
    const browser = local.answers[i];
    if (!browser) {
      if (saved) answers.push(saved);
      continue;
    }
    // Try again clears every item, including ones that were correct. Keep that clear.
    if (local.settled && browser.correct == null) {
      answers.push(browser);
      continue;
    }
    if (!saved || browser.correct === true) {
      answers.push(browser);
      continue;
    }
    if (saved.correct === true) {
      answers.push(saved);
      continue;
    }
    if (browser.correct != null) answers.push(browser);
    else answers.push(saved);
  }
  const bests = [remote.bestCorrect, local.bestCorrect].filter((value): value is number => typeof value === "number");
  const settled = remote.settled === true || local.settled === true;
  return {
    answers,
    ...(bests.length ? { bestCorrect: Math.max(...bests) } : {}),
    ...(settled ? { settled: true } : {}),
  };
}

/** Lift reading and not-yet-synced answers from this browser without replacing saved project fields. */
function unionUnsyncedProgress(remote: LearnPlanProgress, local: LearnPlanProgress): LearnPlanProgress {
  if (!hasStoredLearning(local)) return remote;
  const lessonReadScroll = { ...remote.lessonReadScroll };
  for (const [id, pct] of Object.entries(local.lessonReadScroll)) {
    lessonReadScroll[id] = Math.max(lessonReadScroll[id] ?? 0, pct);
  }
  const lessonReadDone = { ...remote.lessonReadDone };
  for (const [id, done] of Object.entries(local.lessonReadDone)) {
    if (done) lessonReadDone[id] = true;
  }
  const articleScroll = { ...remote.articleScroll };
  for (const [id, pct] of Object.entries(local.articleScroll)) {
    articleScroll[id] = Math.max(articleScroll[id] ?? 0, pct);
  }
  const articleDone = { ...remote.articleDone };
  for (const [id, done] of Object.entries(local.articleDone)) {
    if (done) articleDone[id] = true;
  }
  const lessonQuiz: Record<string, PersistedQuiz> = { ...remote.lessonQuiz };
  for (const id of new Set([...Object.keys(remote.lessonQuiz), ...Object.keys(local.lessonQuiz)])) {
    const quiz = unionQuizSlot(remote.lessonQuiz[id] ?? null, local.lessonQuiz[id] ?? null);
    if (quiz) lessonQuiz[id] = quiz;
  }
  const conceptMastery = { ...remote.conceptMastery };
  for (const [key, row] of Object.entries(local.conceptMastery)) {
    const saved = conceptMastery[key];
    if (!saved || (row.lastReviewedAt ?? 0) > (saved.lastReviewedAt ?? 0)) conceptMastery[key] = row;
  }
  return {
    ...remote,
    lessonReadScroll,
    lessonReadDone,
    articleScroll,
    articleDone,
    lessonQuiz,
    conceptMastery,
    finalQuiz: unionQuizSlot(remote.finalQuiz, local.finalQuiz),
  };
}

/**
 * Progress for one path. Bare lesson keys are not applied here: a copied legacy blob
 * would otherwise show up on every path that uses l1..l4. Claim the workspace first.
 * This browser's cache is adopted only when the saved path has no scoped learning yet
 * and the cache is not stamped for a different plan.
 */
export function mergeLearnProgress(fromProject: unknown, scope: ProgressScope): LearnPlanProgress {
  const remoteNorm = normalizeIncoming(fromProject);
  const remote = projectForScope(remoteNorm, scope);
  const localNorm = readLearnProgress(scope.projectId);
  const localOwned =
    !hasScopedLearning(remote, scope) && (!localNorm.scopeId || localNorm.scopeId === remote.scopeId)
      ? adoptProgressForScope(localNorm, scope)
      : projectForScope(localNorm, scope);
  if (!hasModernFields(fromProject) && !hasLegacyFields(fromProject)) return localOwned;
  return unionUnsyncedProgress(remote, localOwned);
}

function normalizeIncoming(progress: unknown): LearnPlanProgress {
  if (!hasModernFields(progress) && !hasLegacyFields(progress)) return emptyLearnProgress();
  return normalizeLearnProgress(progress);
}

function hasModernFields(progress: unknown): boolean {
  return !!progress && typeof progress === "object" && hasModernProgressFields(progress as Record<string, unknown>);
}

function hasLegacyFields(progress: unknown): boolean {
  return !!progress && typeof progress === "object" && hasLegacyProgressFields(progress as Record<string, unknown>);
}

/**
 * Give legacy unscoped answers to the path they were made on.
 * When two paths share the same answer payload, the earlier path keeps it and the later path starts empty.
 */
export function claimLegacyProgress<T extends ProgressClaimProject>(projects: T[]): T[] {
  const normalized = projects.map((project) => {
    if (project.learnProgress == null) return project;
    return { ...project, learnProgress: normalizeLearnProgress(project.learnProgress) };
  });
  const drop = duplicateProgressIndexes(normalized);
  return normalized.map((project, index) => {
    const progress = project.learnProgress;
    if (!progress) return project;
    const scope = scopeFromProject(project);
    if (drop.has(index)) {
      return {
        ...project,
        learnProgress: scope ? emptyScopedProgress(scope, { screen: "overview" }) : emptyLearnProgress(),
      };
    }
    if (!scope) return project;
    return { ...project, learnProgress: adoptProgressForScope(progress, scope) };
  });
}

export function lessonHasQuiz(lesson: { quiz: unknown[] }): boolean {
  return lesson.quiz.length > 0;
}

export function isLessonStepComplete(
  scope: ProgressScope,
  lessonId: string,
  hasQuiz: boolean,
  progress: LearnPlanProgress,
): boolean {
  if (!readDoneFor(progress, scope, lessonId)) return false;
  if (!hasQuiz) return true;
  return isQuizSettled(lessonQuizFor(progress, scope, lessonId));
}

export function isFinalStepComplete(scope: ProgressScope, progress: LearnPlanProgress, hasFinal: boolean): boolean {
  if (!hasFinal) return false;
  return isQuizSettled(finalQuizFor(progress, scope));
}

export function countPlanProgress(
  scope: ProgressScope,
  lessons: { id: string; hasQuiz: boolean }[],
  hasFinal: boolean,
  progress: LearnPlanProgress,
): { completed: number; total: number; percent: number } {
  let completed = 0;
  let total = lessons.length;
  for (const { id, hasQuiz } of lessons) {
    if (isLessonStepComplete(scope, id, hasQuiz, progress)) completed += 1;
  }
  if (hasFinal) {
    total += 1;
    if (isFinalStepComplete(scope, progress, true)) completed += 1;
  }
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percent };
}

export function resolveLocation(
  planLessons: { id: string }[],
  location: LearnLocation,
): LearnLocation {
  if (location.screen === "overview") return location;
  if (location.screen === "final") return location;
  if (location.screen === "lesson" && location.lessonId && planLessons.some((l) => l.id === location.lessonId)) {
    return location;
  }
  return defaultLocation();
}

export const MAIN_SCROLL_SELECTOR = "[data-learn-scroll]";

export function mainScrollElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const marked = document.querySelector(MAIN_SCROLL_SELECTOR);
  if (marked instanceof HTMLElement) return marked;
  return document.querySelector(".min-w-0.flex-1.overflow-y-auto");
}

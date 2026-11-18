/** Persisted learn course state (per project). */

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
};

export type PersistedQuiz = {
  answers: PersistedQuizAnswer[];
};

/** SM-2 row for one concept. Scheduling fields stay at defaults until the review card. */
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
};

export type LearnPlanProgress = {
  v: 3;
  location: LearnLocation;
  /** Scroll depth 0–100 per lesson (reading). */
  lessonReadScroll: Record<string, number>;
  lessonReadDone: Record<string, boolean>;
  lessonQuiz: Record<string, PersistedQuiz>;
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
  return {
    mcChoice: typeof row.mcChoice === "string" ? row.mcChoice : null,
    shortText: typeof row.shortText === "string" ? row.shortText : "",
    shortSubmitted: row.shortSubmitted === true,
    correct: row.correct === true ? true : row.correct === false ? false : null,
  };
}

function parseQuiz(value: unknown): PersistedQuiz | null {
  if (!value || typeof value !== "object") return null;
  const answers = (value as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return null;
  return { answers: answers.map((item) => parseQuizAnswer(item)) };
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
    const conceptId = typeof row.conceptId === "string" && row.conceptId.trim() ? row.conceptId : key;
    if (!conceptId) continue;
    const conceptLabel =
      typeof row.conceptLabel === "string" && row.conceptLabel.trim() ? row.conceptLabel : conceptId;
    const lessonId = typeof row.lessonId === "string" ? row.lessonId : "";
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
    out[conceptId] = mastery;
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

  const next: LearnPlanProgress = {
    v: 3,
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
  if (!saved?.answers?.length) return emptyQuiz(count);
  if (saved.answers.length === count) return saved;
  const next = emptyQuiz(count);
  for (let i = 0; i < Math.min(saved.answers.length, count); i++) {
    next.answers[i] = saved.answers[i]!;
  }
  return next;
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

export function mergeLearnProgress(fromProject: unknown, projectId: string): LearnPlanProgress {
  if (fromProject && typeof fromProject === "object") {
    const raw = fromProject as Record<string, unknown>;
    // Saved project progress wins, including v2 and unversioned payloads.
    // An unrelated object still falls through to this browser's copy.
    if (hasModernProgressFields(raw) || hasLegacyProgressFields(raw)) return normalizeLearnProgress(fromProject);
  }
  return readLearnProgress(projectId);
}

export function lessonHasQuiz(lesson: { quiz: unknown[] }): boolean {
  return lesson.quiz.length > 0;
}

export function isLessonStepComplete(
  lessonId: string,
  hasQuiz: boolean,
  progress: LearnPlanProgress,
): boolean {
  if (!progress.lessonReadDone[lessonId]) return false;
  if (!hasQuiz) return true;
  const quiz = progress.lessonQuiz[lessonId];
  return quiz ? quizAllAnswered(quiz) : false;
}

export function isFinalStepComplete(progress: LearnPlanProgress, hasFinal: boolean): boolean {
  if (!hasFinal) return false;
  const quiz = progress.finalQuiz;
  return quiz ? quizAllAnswered(quiz) : false;
}

export function countPlanProgress(
  lessons: { id: string; hasQuiz: boolean }[],
  hasFinal: boolean,
  progress: LearnPlanProgress,
): { completed: number; total: number; percent: number } {
  let completed = 0;
  let total = lessons.length;
  for (const { id, hasQuiz } of lessons) {
    if (isLessonStepComplete(id, hasQuiz, progress)) completed += 1;
  }
  if (hasFinal) {
    total += 1;
    if (isFinalStepComplete(progress, true)) completed += 1;
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

export function resumeLabel(
  plan: { lessons: { id: string; order: number; title: string }[] },
  progress: LearnPlanProgress,
  hasFinal: boolean,
): string | null {
  const loc = resolveLocation(plan.lessons, progress.location);
  if (loc.screen === "lesson" && loc.lessonId) {
    const lesson = plan.lessons.find((l) => l.id === loc.lessonId);
    if (lesson) return `Lesson ${lesson.order}: ${lesson.title}`;
  }
  if (loc.screen === "final" && hasFinal) return "Final assessment";
  const next = plan.lessons.find((l) => !progress.lessonReadDone[l.id]);
  if (next) return `Lesson ${next.order}: ${next.title}`;
  if (hasFinal && !isFinalStepComplete(progress, true)) return "Final assessment";
  return null;
}

export function mainScrollElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(".min-w-0.flex-1.overflow-y-auto");
}

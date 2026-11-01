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

export type LearnPlanProgress = {
  v: 2;
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
};

const STORAGE_PREFIX = "learn-progress:";

export function defaultLocation(): LearnLocation {
  return { screen: "overview" };
}

export function emptyLearnProgress(): LearnPlanProgress {
  return {
    v: 2,
    location: defaultLocation(),
    lessonReadScroll: {},
    lessonReadDone: {},
    lessonQuiz: {},
    finalQuiz: null,
    articleScroll: {},
    articleDone: {},
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

/** Fill fields added after v2 so older saved progress still spreads safely. */
export function normalizeLearnProgress(progress: LearnPlanProgress): LearnPlanProgress {
  return {
    ...emptyLearnProgress(),
    ...progress,
    v: 2,
    location: progress.location ?? defaultLocation(),
    lessonReadScroll: progress.lessonReadScroll ?? {},
    lessonReadDone: progress.lessonReadDone ?? {},
    lessonQuiz: progress.lessonQuiz ?? {},
    finalQuiz: progress.finalQuiz ?? null,
    articleScroll: numberMap(progress.articleScroll),
    articleDone: boolMap(progress.articleDone),
  };
}

function emptyQuizAnswer(): PersistedQuizAnswer {
  return { mcChoice: null, shortText: "", shortSubmitted: false, correct: null };
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

function hydrateProgress(parsed: unknown): LearnPlanProgress {
  if (!parsed || typeof parsed !== "object") return emptyLearnProgress();
  const raw = parsed as Record<string, unknown>;
  if (raw.v !== 2) return migrateLegacy(raw);

  const location =
    raw.location && typeof raw.location === "object"
      ? ({
          screen:
            (raw.location as LearnLocation).screen === "lesson" ||
            (raw.location as LearnLocation).screen === "final" ||
            (raw.location as LearnLocation).screen === "overview"
              ? (raw.location as LearnLocation).screen
              : "overview",
          lessonId:
            typeof (raw.location as LearnLocation).lessonId === "string"
              ? (raw.location as LearnLocation).lessonId
              : undefined,
        } satisfies LearnLocation)
      : defaultLocation();

  return normalizeLearnProgress({
    v: 2,
    location,
    lessonReadScroll:
      raw.lessonReadScroll && typeof raw.lessonReadScroll === "object"
        ? (raw.lessonReadScroll as Record<string, number>)
        : {},
    lessonReadDone:
      raw.lessonReadDone && typeof raw.lessonReadDone === "object"
        ? (raw.lessonReadDone as Record<string, boolean>)
        : {},
    lessonQuiz:
      raw.lessonQuiz && typeof raw.lessonQuiz === "object"
        ? (raw.lessonQuiz as Record<string, PersistedQuiz>)
        : {},
    finalQuiz: raw.finalQuiz && typeof raw.finalQuiz === "object" ? (raw.finalQuiz as PersistedQuiz) : null,
    articleScroll: numberMap(raw.articleScroll),
    articleDone: boolMap(raw.articleDone),
  });
}

export function readLearnProgress(projectId: string): LearnPlanProgress {
  if (typeof window === "undefined") return emptyLearnProgress();
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return emptyLearnProgress();
    return hydrateProgress(JSON.parse(raw));
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

export function mergeLearnProgress(
  fromProject: LearnPlanProgress | undefined,
  projectId: string,
): LearnPlanProgress {
  if (fromProject?.v === 2) return normalizeLearnProgress(fromProject);
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

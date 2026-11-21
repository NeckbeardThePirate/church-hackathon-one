/**
 * Lesson progress is stored under project id + plan id + lesson id.
 * Bare keys (`l1`, `final`) are legacy and must not be shown on a different path.
 */
import type { ConceptMastery, LearnPlanProgress, PersistedQuiz, PersistedQuizAnswer } from "./plan-progress.ts";

export const PROGRESS_SEP = "\u001f";
export const FINAL_LESSON_ID = "final";

export type ProgressScope = {
  projectId: string;
  planId: string;
};

export type ProgressClaimProject = {
  id: string;
  updatedAt: number;
  learnPlanId?: string;
  learnPlan?: { id?: string; createdAt?: number } | null;
  learnProgress?: LearnPlanProgress | null;
};

type KeyKind = "bare" | "ours" | "foreign";

export function progressScopeId(scope: ProgressScope): string {
  return `${scope.projectId}${PROGRESS_SEP}${scope.planId}`;
}

export function lessonProgressKey(scope: ProgressScope, lessonId: string): string {
  return `${scope.projectId}${PROGRESS_SEP}${scope.planId}${PROGRESS_SEP}${lessonId}`;
}

export function conceptProgressKey(scope: ProgressScope, conceptId: string): string {
  return lessonProgressKey(scope, conceptId);
}

export function articleProgressKey(scope: ProgressScope, url: string): string {
  return lessonProgressKey(scope, url);
}

export function parseProgressKey(key: string): { projectId: string; planId: string; rest: string } | null {
  const parts = key.split(PROGRESS_SEP);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { projectId: parts[0], planId: parts[1], rest: parts[2] };
}

export function parseScopeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split(PROGRESS_SEP);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return value;
}

export function scopeFromIds(projectId: string, planId: string | undefined): ProgressScope | null {
  if (!projectId || !planId) return null;
  return { projectId, planId };
}

export function scopeFromProject(project: ProgressClaimProject): ProgressScope | null {
  const planId = project.learnPlan?.id || project.learnPlanId;
  return scopeFromIds(project.id, planId);
}

function keyKind(key: string, scope: ProgressScope): KeyKind {
  const parsed = parseProgressKey(key);
  if (!parsed) return "bare";
  if (parsed.projectId === scope.projectId && parsed.planId === scope.planId) return "ours";
  return "foreign";
}

function bareLessonId(key: string): string {
  return key === "__final__" ? FINAL_LESSON_ID : key;
}

function rawLessonId(lessonId: string): string {
  const parsed = parseProgressKey(lessonId);
  if (parsed) return parsed.rest;
  return lessonId === "__final__" ? FINAL_LESSON_ID : lessonId;
}

function rawConceptSlug(conceptId: string, fallback: string): string {
  const parsed = parseProgressKey(conceptId);
  if (parsed) return parsed.rest;
  const trimmed = conceptId.trim();
  return trimmed || fallback;
}

function unionAnswers(remote: PersistedQuiz | undefined, local: PersistedQuiz | undefined): PersistedQuiz | undefined {
  if (!remote) return local;
  if (!local) return remote;
  const length = Math.max(remote.answers.length, local.answers.length);
  const answers: PersistedQuizAnswer[] = [];
  for (let i = 0; i < length; i++) {
    const saved = remote.answers[i];
    const extra = local.answers[i];
    if (!extra) {
      if (saved) answers.push(saved);
      continue;
    }
    if (!saved || extra.correct === true || (extra.mcChoice || extra.shortText) && saved.correct !== true) answers.push(extra);
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

function quizHasAnswer(quiz: PersistedQuiz | null | undefined): boolean {
  if (!quiz) return false;
  return quiz.answers.some((answer) => answer.mcChoice != null || answer.shortText.trim().length > 0 || answer.correct != null);
}

function putNumber(map: Record<string, number>, key: string, value: number, max: boolean): void {
  map[key] = max ? Math.max(map[key] ?? 0, value) : value;
}

function collectLessonIds(progress: LearnPlanProgress, scope: ProgressScope, bare: boolean): Set<string> {
  const ids = new Set<string>();
  const consider = (key: string) => {
    const kind = keyKind(key, scope);
    if (kind === "foreign") return;
    if (kind === "bare" && !bare) return;
    if (kind === "ours" && bare) return;
    ids.add(kind === "ours" ? parseProgressKey(key)!.rest : bareLessonId(key));
  };
  for (const key of Object.keys(progress.lessonReadScroll)) consider(key);
  for (const key of Object.keys(progress.lessonReadDone)) consider(key);
  for (const key of Object.keys(progress.lessonQuiz)) consider(key);
  return ids;
}

function readBareQuiz(progress: LearnPlanProgress, lessonId: string): PersistedQuiz | undefined {
  if (lessonId === FINAL_LESSON_ID && progress.finalQuiz) return progress.finalQuiz;
  return progress.lessonQuiz[lessonId];
}

/**
 * Rewrite this blob so every lesson, article, and concept key includes the scope.
 * Bare keys are adopted. Keys already stored for another path are dropped.
 */
export function adoptProgressForScope(progress: LearnPlanProgress, scope: ProgressScope): LearnPlanProgress {
  const next = projectForScope(progress, scope);
  for (const lessonId of collectLessonIds(progress, scope, true)) {
    const dest = lessonProgressKey(scope, lessonId);
    const scroll = progress.lessonReadScroll[lessonId];
    if (typeof scroll === "number") putNumber(next.lessonReadScroll, dest, scroll, true);
    if (progress.lessonReadDone[lessonId] === true || (lessonId === FINAL_LESSON_ID && progress.lessonReadDone.__final__ === true)) {
      next.lessonReadDone[dest] = true;
    } else if (progress.lessonReadDone[lessonId] === false && next.lessonReadDone[dest] === undefined) {
      next.lessonReadDone[dest] = false;
    }
    const quiz = unionAnswers(next.lessonQuiz[dest], readBareQuiz(progress, lessonId));
    if (quiz) next.lessonQuiz[dest] = quiz;
  }
  if (progress.finalQuiz) {
    const dest = lessonProgressKey(scope, FINAL_LESSON_ID);
    const quiz = unionAnswers(next.lessonQuiz[dest], progress.finalQuiz);
    if (quiz) next.lessonQuiz[dest] = quiz;
  }
  for (const [url, value] of Object.entries(progress.articleScroll)) {
    if (keyKind(url, scope) !== "bare") continue;
    putNumber(next.articleScroll, articleProgressKey(scope, url), value, true);
  }
  for (const [url, done] of Object.entries(progress.articleDone)) {
    if (keyKind(url, scope) !== "bare") continue;
    if (done) next.articleDone[articleProgressKey(scope, url)] = true;
    else if (next.articleDone[articleProgressKey(scope, url)] === undefined) next.articleDone[articleProgressKey(scope, url)] = false;
  }
  next.conceptMastery = {
    ...next.conceptMastery,
    ...scopeConceptRows(progress.conceptMastery, scope, true),
  };
  next.finalQuiz = null;
  next.scopeId = progressScopeId(scope);
  return next;
}

/** Keep only slots that already belong to this path. Bare and foreign slots are omitted. */
export function projectForScope(progress: LearnPlanProgress, scope: ProgressScope): LearnPlanProgress {
  const next: LearnPlanProgress = {
    v: 3,
    scopeId: progressScopeId(scope),
    location: progress.scopeId && progress.scopeId !== progressScopeId(scope) ? { screen: "overview" } : progress.location,
    lessonReadScroll: {},
    lessonReadDone: {},
    lessonQuiz: {},
    finalQuiz: null,
    articleScroll: {},
    articleDone: {},
    conceptMastery: {},
  };
  for (const lessonId of collectLessonIds(progress, scope, false)) {
    const src = lessonProgressKey(scope, lessonId);
    if (typeof progress.lessonReadScroll[src] === "number") next.lessonReadScroll[src] = progress.lessonReadScroll[src];
    if (progress.lessonReadDone[src] === true || progress.lessonReadDone[src] === false) {
      next.lessonReadDone[src] = progress.lessonReadDone[src];
    }
    const quiz = progress.lessonQuiz[src];
    if (quiz) next.lessonQuiz[src] = quiz;
  }
  for (const [url, value] of Object.entries(progress.articleScroll)) {
    if (keyKind(url, scope) !== "ours") continue;
    next.articleScroll[url] = value;
  }
  for (const [url, done] of Object.entries(progress.articleDone)) {
    if (keyKind(url, scope) !== "ours") continue;
    next.articleDone[url] = done;
  }
  next.conceptMastery = scopeConceptRows(progress.conceptMastery, scope, false);
  return next;
}

function scopeConceptRows(
  mastery: Record<string, ConceptMastery>,
  scope: ProgressScope,
  bare: boolean,
): Record<string, ConceptMastery> {
  const out: Record<string, ConceptMastery> = {};
  for (const [key, row] of Object.entries(mastery)) {
    const kind = keyKind(key, scope);
    if (kind === "foreign") continue;
    if (kind === "bare" && !bare) continue;
    if (kind === "ours" && bare) continue;
    const slug = rawConceptSlug(row.conceptId, kind === "ours" ? parseProgressKey(key)!.rest : key);
    const storageKey = kind === "ours" ? key : conceptProgressKey(scope, slug);
    out[storageKey] = {
      ...row,
      conceptId: slug,
      lessonId: rawLessonId(row.lessonId),
    };
  }
  return out;
}

export function lessonQuizFor(
  progress: LearnPlanProgress | null | undefined,
  scope: ProgressScope,
  lessonId: string,
): PersistedQuiz | undefined {
  if (!progress) return undefined;
  return progress.lessonQuiz[lessonProgressKey(scope, lessonId)];
}

export function finalQuizFor(progress: LearnPlanProgress | null | undefined, scope: ProgressScope): PersistedQuiz | null {
  return lessonQuizFor(progress, scope, FINAL_LESSON_ID) ?? null;
}

export function readScrollFor(progress: LearnPlanProgress, scope: ProgressScope, lessonId: string): number {
  return progress.lessonReadScroll[lessonProgressKey(scope, lessonId)] ?? 0;
}

export function readDoneFor(progress: LearnPlanProgress, scope: ProgressScope, lessonId: string): boolean {
  return progress.lessonReadDone[lessonProgressKey(scope, lessonId)] === true;
}

export function articleScrollFor(progress: LearnPlanProgress, scope: ProgressScope, url: string): number {
  return progress.articleScroll[articleProgressKey(scope, url)] ?? 0;
}

export function articleDoneFor(progress: LearnPlanProgress, scope: ProgressScope, url: string): boolean {
  return progress.articleDone[articleProgressKey(scope, url)] === true;
}

export function withReadState(
  progress: LearnPlanProgress,
  scope: ProgressScope,
  lessonId: string,
  scroll: number,
  done: boolean,
): LearnPlanProgress {
  const key = lessonProgressKey(scope, lessonId);
  return {
    ...progress,
    scopeId: progressScopeId(scope),
    finalQuiz: null,
    lessonReadScroll: { ...progress.lessonReadScroll, [key]: scroll },
    lessonReadDone: { ...progress.lessonReadDone, [key]: done },
  };
}

export function withLessonQuiz(
  progress: LearnPlanProgress,
  scope: ProgressScope,
  lessonId: string,
  quiz: PersistedQuiz,
): LearnPlanProgress {
  const key = lessonProgressKey(scope, lessonId);
  return {
    ...progress,
    scopeId: progressScopeId(scope),
    finalQuiz: null,
    lessonQuiz: { ...progress.lessonQuiz, [key]: quiz },
  };
}

export function withFinalQuiz(progress: LearnPlanProgress, scope: ProgressScope, quiz: PersistedQuiz): LearnPlanProgress {
  return withLessonQuiz(progress, scope, FINAL_LESSON_ID, quiz);
}

export function withArticleScroll(
  progress: LearnPlanProgress,
  scope: ProgressScope,
  url: string,
  percent: number,
): LearnPlanProgress {
  const key = articleProgressKey(scope, url);
  return {
    ...progress,
    scopeId: progressScopeId(scope),
    articleScroll: { ...progress.articleScroll, [key]: percent },
  };
}

export function withArticleDone(
  progress: LearnPlanProgress,
  scope: ProgressScope,
  url: string,
  done: boolean,
): LearnPlanProgress {
  const key = articleProgressKey(scope, url);
  return {
    ...progress,
    scopeId: progressScopeId(scope),
    articleDone: { ...progress.articleDone, [key]: done },
  };
}

export function withConceptMastery(
  progress: LearnPlanProgress,
  scope: ProgressScope,
  conceptId: string,
  row: ConceptMastery,
): LearnPlanProgress {
  const slug = rawConceptSlug(conceptId, conceptId);
  const key = conceptProgressKey(scope, slug);
  return {
    ...progress,
    scopeId: progressScopeId(scope),
    conceptMastery: {
      ...progress.conceptMastery,
      [key]: { ...row, conceptId: slug, lessonId: rawLessonId(row.lessonId) },
    },
  };
}

/** Scope a plan-DO mastery map (bare concept ids) onto one path. */
export function scopeConceptMastery(
  mastery: Record<string, ConceptMastery>,
  scope: ProgressScope,
): Record<string, ConceptMastery> {
  return scopeConceptRows(mastery, scope, true);
}

function quizSnapshot(quiz: PersistedQuiz | null | undefined): unknown {
  if (!quiz) return null;
  return quiz.answers.map((answer) => ({
    mc: answer.mcChoice,
    text: answer.shortText,
    submitted: answer.shortSubmitted,
    correct: answer.correct,
    score: answer.score ?? null,
  }));
}

/** Answer payload for one path, ignoring key scope. Blank when no question has an answer. */
export function answerFingerprint(progress: LearnPlanProgress, scope: ProgressScope | null): string {
  const adopted = scope ? adoptProgressForScope(progress, scope) : progress;
  const lessons = scope ? collectLessonIds(adopted, scope, false) : bareLessonIds(progress);
  const body: Record<string, unknown> = {};
  let answered = false;
  for (const lessonId of [...lessons].sort()) {
    const quiz = scope ? lessonQuizFor(adopted, scope, lessonId) : progress.lessonQuiz[lessonId];
    if (quizHasAnswer(quiz)) answered = true;
    if (quiz) body[lessonId] = quizSnapshot(quiz);
  }
  if (!scope && progress.finalQuiz) {
    if (quizHasAnswer(progress.finalQuiz)) answered = true;
    body[FINAL_LESSON_ID] = quizSnapshot(unionAnswers(progress.lessonQuiz[FINAL_LESSON_ID], progress.finalQuiz));
  }
  if (!answered) return "";
  return JSON.stringify(body);
}

function bareLessonIds(progress: LearnPlanProgress): Set<string> {
  const ids = new Set<string>();
  for (const key of [...Object.keys(progress.lessonQuiz), ...Object.keys(progress.lessonReadScroll), ...Object.keys(progress.lessonReadDone)]) {
    if (!parseProgressKey(key)) ids.add(bareLessonId(key));
  }
  if (progress.finalQuiz) ids.add(FINAL_LESSON_ID);
  return ids;
}

export function pathStamp(project: ProgressClaimProject): number {
  const created = project.learnPlan?.createdAt;
  if (typeof created === "number" && Number.isFinite(created) && created > 0) return created;
  return project.updatedAt;
}

function earlierProject(projects: ProgressClaimProject[], indexes: number[]): number {
  return indexes.reduce((best, index) => {
    const stamp = pathStamp(projects[index]!);
    const bestStamp = pathStamp(projects[best]!);
    if (stamp !== bestStamp) return stamp < bestStamp ? index : best;
    return projects[index]!.id < projects[best]!.id ? index : best;
  });
}

/**
 * Identical answer payloads came from one path. The earliest path keeps them.
 * A newer path with the same answers, including a copied unscoped blob, loses them.
 */
export function duplicateProgressIndexes(projects: ProgressClaimProject[]): Set<number> {
  const groups = new Map<string, number[]>();
  projects.forEach((project, index) => {
    const progress = project.learnProgress;
    if (!progress) return;
    const scope = scopeFromProject(project);
    const fingerprint = answerFingerprint(progress, scope);
    if (!fingerprint) return;
    const bucket = groups.get(fingerprint) ?? [];
    bucket.push(index);
    groups.set(fingerprint, bucket);
  });
  const drop = new Set<number>();
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const owner = earlierProject(projects, indexes);
    for (const index of indexes) if (index !== owner) drop.add(index);
  }
  return drop;
}

export function emptyScopedProgress(scope: ProgressScope, location: LearnPlanProgress["location"]): LearnPlanProgress {
  return {
    v: 3,
    scopeId: progressScopeId(scope),
    location,
    lessonReadScroll: {},
    lessonReadDone: {},
    lessonQuiz: {},
    finalQuiz: null,
    articleScroll: {},
    articleDone: {},
    conceptMastery: {},
  };
}

export function hasScopedLearning(progress: LearnPlanProgress, scope: ProgressScope): boolean {
  const key = progressScopeId(scope);
  const prefixed = `${key}${PROGRESS_SEP}`;
  const maps = [progress.lessonReadScroll, progress.lessonReadDone, progress.lessonQuiz, progress.articleScroll, progress.articleDone, progress.conceptMastery];
  return maps.some((map) => Object.keys(map).some((id) => id.startsWith(prefixed)));
}

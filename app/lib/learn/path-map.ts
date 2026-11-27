/**
 * Path-map layout and the five node states.
 * States come from the stored plan plus LearnPlanProgress.
 * They do not use isLessonStepComplete.
 */

import type { LearnPlanProgress, PersistedQuiz } from "./plan-progress.ts";
import {
  FINAL_LESSON_ID,
  finalQuizFor,
  lessonQuizFor,
  parseProgressKey,
  readDoneFor,
  readScrollFor,
  type ProgressScope,
} from "./progress-scope.ts";
import { lessonKind, type LearnLesson } from "./types.ts";

export type PathNodeState = "locked" | "available" | "in-progress" | "needs-review" | "mastered";

export type PathNodeKind = "core" | "gap" | "final";

export type PathMapNode = {
  id: string;
  kind: PathNodeKind;
  title: string;
  order: number;
  state: PathNodeState;
  /** Direct prerequisites that are not yet passed, in listed order. */
  unmet: { id: string; title: string }[];
  /** Core lesson this gap hangs from. Null for core lessons and the final. */
  parentId: string | null;
  current: boolean;
  estimatedMinutes?: number;
  /** Outline exists, but the teaching and quiz are still being written. */
  building: boolean;
};

export type PathMapInput = {
  lessons: LearnLesson[];
  /**
   * Final assessment items. An empty list omits the final node.
   * Only conceptId is read, so a due review can move that node.
   */
  finalAssessment?: readonly { conceptId?: string }[];
  progress: LearnPlanProgress;
  scope: ProgressScope;
  now: number;
};

type IndexedLesson = { lesson: LearnLesson; index: number };

/**
 * Correct answers required on a submitted attempt.
 * 80% of the item count, rounded down to a whole question.
 * A 3-item quiz uses all-but-one (2), the same floor, so one miss still passes.
 * One question requires that question: zero correct is not 80%.
 */
export function requiredCorrect(itemCount: number): number {
  if (itemCount <= 0) return 0;
  if (itemCount === 3) return 2;
  return Math.max(1, Math.floor((itemCount * 80) / 100));
}

export function attemptPassed(correct: number, itemCount: number): boolean {
  if (itemCount <= 0 || !Number.isFinite(correct) || correct < 0) return false;
  return correct >= requiredCorrect(itemCount);
}

function byOrderThenIndex(a: IndexedLesson, b: IndexedLesson): number {
  return a.lesson.order - b.lesson.order || a.index - b.index;
}

function lessonTitle(lesson: LearnLesson): string {
  const title = lesson.title.trim();
  if (title) return title;
  return `Lesson ${lesson.order}`;
}

/** Core ancestor a gap hangs from. Follows sourceLessonId, then stops. */
function gapAnchorId(lesson: LearnLesson, byId: Map<string, LearnLesson>): string | null {
  const seen = new Set<string>();
  let current: LearnLesson | undefined = lesson;
  while (current && lessonKind(current) === "gap") {
    const parentId = current.sourceLessonId;
    if (!parentId || seen.has(parentId)) return null;
    seen.add(current.id);
    const parent = byId.get(parentId);
    if (!parent) return null;
    if (lessonKind(parent) !== "gap") return parent.id;
    current = parent;
  }
  return null;
}

/**
 * Core lessons in LearnLesson.order.
 * Each gap is placed after its parent and before the next core lesson,
 * even when it was appended to the plan without a new order number.
 */
export function arrangePathLessons(lessons: LearnLesson[]): { lesson: LearnLesson; parentId: string | null }[] {
  const indexed = lessons.map((lesson, index) => ({ lesson, index }));
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const cores = indexed.filter((item) => lessonKind(item.lesson) !== "gap").sort(byOrderThenIndex);
  const coreIds = new Set(cores.map((item) => item.lesson.id));
  const gapsByParent = new Map<string, IndexedLesson[]>();
  const orphans: IndexedLesson[] = [];

  for (const item of indexed) {
    if (lessonKind(item.lesson) !== "gap") continue;
    const anchor = gapAnchorId(item.lesson, byId);
    if (anchor && coreIds.has(anchor)) {
      const list = gapsByParent.get(anchor) ?? [];
      list.push(item);
      gapsByParent.set(anchor, list);
    } else {
      orphans.push(item);
    }
  }
  for (const list of gapsByParent.values()) list.sort(byOrderThenIndex);
  orphans.sort(byOrderThenIndex);

  const arranged: { lesson: LearnLesson; parentId: string | null }[] = [];
  const placedOrphans = new Set<string>();
  const placeOrphansBefore = (order: number) => {
    for (const orphan of orphans) {
      if (placedOrphans.has(orphan.lesson.id)) continue;
      if (orphan.lesson.order > order) continue;
      placedOrphans.add(orphan.lesson.id);
      arranged.push({ lesson: orphan.lesson, parentId: null });
    }
  };

  for (const core of cores) {
    placeOrphansBefore(core.lesson.order);
    arranged.push({ lesson: core.lesson, parentId: null });
    for (const gap of gapsByParent.get(core.lesson.id) ?? []) {
      arranged.push({ lesson: gap.lesson, parentId: core.lesson.id });
    }
  }
  for (const orphan of orphans) {
    if (placedOrphans.has(orphan.lesson.id)) continue;
    arranged.push({ lesson: orphan.lesson, parentId: null });
  }
  return arranged;
}

function quizStarted(quiz: PersistedQuiz | null | undefined): boolean {
  if (!quiz) return false;
  return quiz.answers.some(
    (answer) =>
      answer.correct !== null ||
      answer.mcChoice !== null ||
      answer.shortSubmitted ||
      answer.shortText.trim().length > 0,
  );
}

/** Score of a finished attempt. Null until every item has been submitted once. */
function submittedCorrect(quiz: PersistedQuiz | null | undefined, itemCount: number): number | null {
  if (!quiz || itemCount <= 0) return null;
  const answers = quiz.answers.slice(0, itemCount);
  const fullyGraded = answers.length === itemCount && answers.every((answer) => answer.correct !== null);
  if (quiz.settled !== true && !fullyGraded) return null;
  const current = answers.filter((answer) => answer.correct === true).length;
  return Math.max(quiz.bestCorrect ?? 0, current);
}

function lessonConcepts(
  progress: LearnPlanProgress,
  scope: ProgressScope,
  lessonId: string,
  conceptIds: readonly string[],
) {
  const wanted = new Set(conceptIds);
  const rows = [];
  for (const [key, row] of Object.entries(progress.conceptMastery)) {
    const parsed = parseProgressKey(key);
    if (parsed && (parsed.projectId !== scope.projectId || parsed.planId !== scope.planId)) continue;
    const slug = parsed?.rest || row.conceptId;
    const rowLesson = parseProgressKey(row.lessonId)?.rest ?? row.lessonId;
    if (rowLesson === lessonId || wanted.has(slug) || wanted.has(row.conceptId)) rows.push(row);
  }
  return rows;
}

/** dueAt of 0 is not scheduled. A positive timestamp that has passed is due. */
function conceptsOverdue(
  progress: LearnPlanProgress,
  scope: ProgressScope,
  lessonId: string,
  conceptIds: readonly string[],
  now: number,
): boolean {
  return lessonConcepts(progress, scope, lessonId, conceptIds).some((row) => row.dueAt > 0 && row.dueAt <= now);
}

type WorkStatus = {
  id: string;
  passed: boolean;
  state: Exclude<PathNodeState, "locked">;
};

function workStatus(input: {
  id: string;
  itemCount: number;
  quiz: PersistedQuiz | null | undefined;
  started: boolean;
  readDone: boolean;
  overdue: boolean;
}): WorkStatus {
  const submitted = submittedCorrect(input.quiz, input.itemCount);
  const passed =
    input.itemCount > 0 ? submitted !== null && attemptPassed(submitted, input.itemCount) : input.readDone;
  let state: WorkStatus["state"];
  if (input.itemCount > 0 && submitted !== null) {
    state = passed && !input.overdue ? "mastered" : "needs-review";
  } else if (input.itemCount === 0 && input.readDone) {
    state = input.overdue ? "needs-review" : "mastered";
  } else if (input.started) {
    state = "in-progress";
  } else {
    state = "available";
  }
  return { id: input.id, passed, state };
}

function directUnmet(
  prerequisiteIds: readonly string[],
  titles: Map<string, string>,
  passed: Set<string>,
): { id: string; title: string }[] {
  const unmet = [];
  for (const id of prerequisiteIds) {
    if (!titles.has(id) || passed.has(id)) continue;
    unmet.push({ id, title: titles.get(id)! });
  }
  return unmet;
}

function markCurrent(nodes: PathMapNode[]): PathMapNode[] {
  const current =
    nodes.find((node) => node.state === "in-progress") ??
    nodes.find((node) => node.state === "needs-review") ??
    nodes.find((node) => node.state === "available") ??
    null;
  if (!current) return nodes;
  return nodes.map((node) => (node.id === current.id ? { ...node, current: true } : node));
}

export function derivePathMap(input: PathMapInput): PathMapNode[] {
  const arranged = arrangePathLessons(input.lessons);
  const titles = new Map(arranged.map((item) => [item.lesson.id, lessonTitle(item.lesson)]));
  const work = new Map<string, WorkStatus>();

  for (const item of arranged) {
    const lesson = item.lesson;
    const quiz = lessonQuizFor(input.progress, input.scope, lesson.id);
    const readDone = readDoneFor(input.progress, input.scope, lesson.id);
    const readScroll = readScrollFor(input.progress, input.scope, lesson.id);
    const conceptIds = lesson.quiz.map((question) => question.conceptId).filter((id): id is string => !!id);
    work.set(
      lesson.id,
      workStatus({
        id: lesson.id,
        itemCount: lesson.quiz.length,
        quiz,
        started: readDone || readScroll > 0 || quizStarted(quiz),
        readDone,
        overdue: conceptsOverdue(input.progress, input.scope, lesson.id, conceptIds, input.now),
      }),
    );
  }

  const passed = new Set([...work.values()].filter((status) => status.passed).map((status) => status.id));
  const nodes: PathMapNode[] = arranged.map((item) => {
    const status = work.get(item.lesson.id)!;
    const unmet = directUnmet(item.lesson.prerequisiteLessonIds, titles, passed);
    const state: PathNodeState = !status.passed && unmet.length > 0 ? "locked" : status.state;
    return {
      id: item.lesson.id,
      kind: lessonKind(item.lesson) === "gap" ? "gap" : "core",
      title: lessonTitle(item.lesson),
      order: item.lesson.order,
      state,
      unmet: state === "locked" ? unmet : [],
      parentId: item.parentId,
      current: false,
      estimatedMinutes: item.lesson.estimatedMinutes,
      building: item.lesson.status === "pending",
    };
  });

  const finalAssessment = input.finalAssessment ?? [];
  if (finalAssessment.length > 0) {
    const quiz = finalQuizFor(input.progress, input.scope);
    const conceptIds = finalAssessment.map((item) => item.conceptId).filter((id): id is string => !!id);
    const status = workStatus({
      id: FINAL_LESSON_ID,
      itemCount: finalAssessment.length,
      quiz,
      started: quizStarted(quiz),
      readDone: false,
      overdue: conceptsOverdue(input.progress, input.scope, FINAL_LESSON_ID, conceptIds, input.now),
    });
    const coreUnmet = nodes
      .filter((node) => node.kind === "core" && !passed.has(node.id))
      .map((node) => ({ id: node.id, title: node.title }));
    const state: PathNodeState = !status.passed && coreUnmet.length > 0 ? "locked" : status.state;
    nodes.push({
      id: FINAL_LESSON_ID,
      kind: "final",
      title: "Final assessment",
      order: nodes.length + 1,
      state,
      unmet: state === "locked" ? coreUnmet : [],
      parentId: null,
      current: false,
      building: false,
    });
  }

  return markCurrent(nodes);
}

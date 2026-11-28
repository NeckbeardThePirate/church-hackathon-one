/**
 * Workspace progress: mastery per path, reviews that are due, and one next action.
 * Next action order is due reviews, then a gap lesson, then the next lesson.
 */

import type { LearnPlanProgress } from "./plan-progress.ts";
import { emptyLearnProgress, type LearnLocation } from "./plan-progress.ts";
import { finalMasteryPercent, lessonMasteryPercent } from "./learner-stats.ts";
import { derivePathMap, type PathMapInput, type PathMapNode } from "./path-map.ts";
import { scopeFromProject } from "./progress-scope.ts";
import { indexMasteryByConcept, reviewQueue } from "./sm2.ts";
import type { LearnLesson, QuizItem } from "./types.ts";

export type DashboardPlan = {
  id: string;
  lessons: LearnLesson[];
  finalAssessment?: QuizItem[];
};

export type DashboardProject = {
  id: string;
  title: string;
  updatedAt: number;
  learnPlan?: DashboardPlan | null;
  learnProgress?: LearnPlanProgress | null;
};

export type PathSummary = {
  projectId: string;
  title: string;
  percent: number;
  reviewsDue: number;
};

export type NextAction =
  | { kind: "reviews"; projectId: string; pathTitle: string; count: number; label: string }
  | { kind: "gap"; projectId: string; lessonId: string; pathTitle: string; label: string }
  | { kind: "lesson"; projectId: string; lessonId: string; pathTitle: string; label: string }
  | { kind: "final"; projectId: string; pathTitle: string; label: string }
  | { kind: "none"; label: string };

type ScopedPath = {
  project: DashboardProject;
  plan: DashboardPlan;
  progress: LearnPlanProgress;
  scope: NonNullable<ReturnType<typeof scopeFromProject>>;
  nodes: PathMapNode[];
  reviewsDue: number;
  earliestDue: number;
};

function pathTitle(project: DashboardProject): string {
  const title = project.title.trim();
  return title || "Untitled path";
}

function scopedPaths(projects: readonly DashboardProject[], now: number): ScopedPath[] {
  const paths: ScopedPath[] = [];
  for (const project of projects) {
    const plan = project.learnPlan;
    if (!plan?.id || !plan.lessons) continue;
    const scope = scopeFromProject({ ...project, learnPlan: plan });
    if (!scope) continue;
    const progress = project.learnProgress ?? emptyLearnProgress();
    const nodes = derivePathMap({
      lessons: plan.lessons,
      finalAssessment: plan.finalAssessment,
      progress,
      scope,
      now,
    });
    const queue = reviewQueue(plan, indexMasteryByConcept(progress.conceptMastery), now);
    paths.push({
      project,
      plan,
      progress,
      scope,
      nodes,
      reviewsDue: queue.length,
      earliestDue: queue[0]?.concept.dueAt ?? Number.POSITIVE_INFINITY,
    });
  }
  paths.sort((a, b) => b.project.updatedAt - a.project.updatedAt || a.project.id.localeCompare(b.project.id));
  return paths;
}

export type PathProgressFigures = {
  completed: number;
  total: number;
  /** Average of each step's mastery. A step in progress moves this before it is complete. */
  percent: number;
  masteredIds: ReadonlySet<string>;
  nodes: PathMapNode[];
};

/**
 * One progress reading for the path card, the lesson rail, and the check marks.
 * A check is a mastered step. The percent is the average mastery of every step,
 * so a lesson at 63% does not leave the path at 0.
 */
export function pathProgressFigures(input: PathMapInput): PathProgressFigures {
  const nodes = derivePathMap(input);
  const masteredIds = new Set(nodes.filter((node) => node.state === "mastered").map((node) => node.id));
  const lessons = new Map(input.lessons.map((lesson) => [lesson.id, lesson]));
  const percents = nodes.map((node) => {
    if (node.kind === "final") {
      return finalMasteryPercent({
        scope: input.scope,
        quizCount: input.finalAssessment?.length ?? 0,
        progress: input.progress,
      });
    }
    return lessonMasteryPercent({
      scope: input.scope,
      lessonId: node.id,
      quizCount: lessons.get(node.id)?.quiz.length ?? 0,
      progress: input.progress,
    });
  });
  const percent = percents.length ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length) : 0;
  return { completed: masteredIds.size, total: nodes.length, percent, masteredIds, nodes };
}

export function pathSummaries(projects: readonly DashboardProject[], now: number): PathSummary[] {
  return scopedPaths(projects, now).map((path) => {
    const figures = pathProgressFigures({
      lessons: path.plan.lessons,
      finalAssessment: path.plan.finalAssessment,
      progress: path.progress,
      scope: path.scope,
      now,
    });
    return {
      projectId: path.project.id,
      title: pathTitle(path.project),
      percent: figures.percent,
      reviewsDue: path.reviewsDue,
    };
  });
}

function openNode(node: PathMapNode): boolean {
  if (node.building) return false;
  return node.state === "available" || node.state === "in-progress" || node.state === "needs-review";
}

type OpenStep =
  | { kind: "reviews"; count: number }
  | { kind: "gap" | "lesson" | "final"; node: PathMapNode };

/** Due reviews, then an open gap, then the first unlocked core lesson, then the final. */
function openStep(path: ScopedPath): OpenStep | null {
  if (path.reviewsDue > 0) return { kind: "reviews", count: path.reviewsDue };
  const gap = path.nodes.find((node) => node.kind === "gap" && openNode(node));
  if (gap) return { kind: "gap", node: gap };
  const lesson = path.nodes.find((node) => node.kind === "core" && openNode(node));
  if (lesson) return { kind: "lesson", node: lesson };
  const finalNode = path.nodes.find((node) => node.kind === "final" && openNode(node));
  if (finalNode) return { kind: "final", node: finalNode };
  return null;
}

function actionFromStep(path: ScopedPath, step: OpenStep, label: string): NextAction {
  const pathTitleText = pathTitle(path.project);
  if (step.kind === "reviews") {
    return { kind: "reviews", projectId: path.project.id, pathTitle: pathTitleText, count: step.count, label };
  }
  if (step.kind === "final") return { kind: "final", projectId: path.project.id, pathTitle: pathTitleText, label };
  return {
    kind: step.kind,
    projectId: path.project.id,
    lessonId: step.node.id,
    pathTitle: pathTitleText,
    label,
  };
}

function dashboardLabel(step: OpenStep): string {
  if (step.kind === "reviews") return `Review ${step.count} due`;
  if (step.kind === "final") return "Final assessment";
  return step.node.title;
}

/** Course-home label. It names the lesson the button opens, including its number. */
function courseLabel(step: OpenStep): string {
  if (step.kind === "reviews") return `Review ${step.count} due`;
  if (step.kind === "final") return "Final assessment";
  if (step.kind === "gap") return step.node.title;
  return `Lesson ${step.node.order}: ${step.node.title}`;
}

/** One next step for the whole workspace. Due reviews win, then any gap lesson, then the next lesson. */
export function nextLearningAction(projects: readonly DashboardProject[], now: number): NextAction {
  const paths = scopedPaths(projects, now);
  const review = [...paths]
    .filter((path) => path.reviewsDue > 0)
    .sort((a, b) => a.earliestDue - b.earliestDue || b.project.updatedAt - a.project.updatedAt)[0];
  if (review) {
    const step = openStep(review);
    if (step?.kind === "reviews") return actionFromStep(review, step, dashboardLabel(step));
  }
  for (const path of paths) {
    const gap = path.nodes.find((node) => node.kind === "gap" && openNode(node));
    if (gap) return actionFromStep(path, { kind: "gap", node: gap }, gap.title);
  }
  for (const path of paths) {
    const lesson = path.nodes.find((node) => node.kind === "core" && openNode(node));
    if (lesson) return actionFromStep(path, { kind: "lesson", node: lesson }, lesson.title);
    const finalNode = path.nodes.find((node) => node.kind === "final" && openNode(node));
    if (finalNode) return actionFromStep(path, { kind: "final", node: finalNode }, "Final assessment");
  }
  return { kind: "none", label: "Start a path" };
}

/**
 * Continue on one course. The label and the lesson id come from the same step,
 * so a stored location on a later locked lesson cannot name one lesson and open another.
 * Saved progress.location is not read.
 */
export function courseContinue(project: DashboardProject, now: number): NextAction | null {
  const path = scopedPaths([project], now)[0];
  if (!path) return null;
  const step = openStep(path);
  if (!step) return null;
  return actionFromStep(path, step, courseLabel(step));
}

export function actionTarget(action: NextAction): { projectId: string; location: LearnLocation; review: boolean } | null {
  if (action.kind === "none") return null;
  if (action.kind === "reviews") return { projectId: action.projectId, location: { screen: "overview" }, review: true };
  if (action.kind === "final") return { projectId: action.projectId, location: { screen: "final" }, review: false };
  return { projectId: action.projectId, location: { screen: "lesson", lessonId: action.lessonId }, review: false };
}

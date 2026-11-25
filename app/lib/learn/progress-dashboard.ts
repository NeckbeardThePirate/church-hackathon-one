/**
 * Workspace progress: mastery per path, reviews that are due, and one next action.
 * Next action order is due reviews, then a gap lesson, then the next lesson.
 */

import type { LearnPlanProgress } from "./plan-progress.ts";
import { emptyLearnProgress, type LearnLocation } from "./plan-progress.ts";
import { derivePathMap, type PathMapNode } from "./path-map.ts";
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
      nodes,
      reviewsDue: queue.length,
      earliestDue: queue[0]?.concept.dueAt ?? Number.POSITIVE_INFINITY,
    });
  }
  paths.sort((a, b) => b.project.updatedAt - a.project.updatedAt || a.project.id.localeCompare(b.project.id));
  return paths;
}

export function pathSummaries(projects: readonly DashboardProject[], now: number): PathSummary[] {
  return scopedPaths(projects, now).map((path) => {
    const mastered = path.nodes.filter((node) => node.state === "mastered").length;
    const percent = path.nodes.length ? Math.round((mastered / path.nodes.length) * 100) : 0;
    return {
      projectId: path.project.id,
      title: pathTitle(path.project),
      percent,
      reviewsDue: path.reviewsDue,
    };
  });
}

function openNode(node: PathMapNode): boolean {
  return node.state === "available" || node.state === "in-progress" || node.state === "needs-review";
}

/** One next step for the whole workspace. Due reviews win, then a gap lesson, then the next lesson. */
export function nextLearningAction(projects: readonly DashboardProject[], now: number): NextAction {
  const paths = scopedPaths(projects, now);
  const review = [...paths]
    .filter((path) => path.reviewsDue > 0)
    .sort((a, b) => a.earliestDue - b.earliestDue || b.project.updatedAt - a.project.updatedAt)[0];
  if (review) {
    return {
      kind: "reviews",
      projectId: review.project.id,
      pathTitle: pathTitle(review.project),
      count: review.reviewsDue,
      label: `Review ${review.reviewsDue} due`,
    };
  }
  for (const path of paths) {
    const gap = path.nodes.find((node) => node.kind === "gap" && openNode(node));
    if (!gap) continue;
    return {
      kind: "gap",
      projectId: path.project.id,
      lessonId: gap.id,
      pathTitle: pathTitle(path.project),
      label: gap.title,
    };
  }
  for (const path of paths) {
    const lesson = path.nodes.find((node) => node.kind === "core" && openNode(node));
    if (lesson) {
      return {
        kind: "lesson",
        projectId: path.project.id,
        lessonId: lesson.id,
        pathTitle: pathTitle(path.project),
        label: lesson.title,
      };
    }
    const finalNode = path.nodes.find((node) => node.kind === "final" && openNode(node));
    if (finalNode) {
      return {
        kind: "final",
        projectId: path.project.id,
        pathTitle: pathTitle(path.project),
        label: "Final assessment",
      };
    }
  }
  return { kind: "none", label: "Start a path" };
}

export function actionTarget(action: NextAction): { projectId: string; location: LearnLocation; review: boolean } | null {
  if (action.kind === "none") return null;
  if (action.kind === "reviews") return { projectId: action.projectId, location: { screen: "overview" }, review: true };
  if (action.kind === "final") return { projectId: action.projectId, location: { screen: "final" }, review: false };
  return { projectId: action.projectId, location: { screen: "lesson", lessonId: action.lessonId }, review: false };
}

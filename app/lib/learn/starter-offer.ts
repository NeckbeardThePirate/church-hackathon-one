import { isEmptyLearnPath, type Project } from "../projects.ts";

/** True only when the signed-in workspace has no real path yet. */
export function shouldOfferStarterPath(
  projects: readonly Pick<Project, "kind" | "title" | "learnPlan" | "learnPlanId">[],
): boolean {
  return projects.every((project) => isEmptyLearnPath(project));
}

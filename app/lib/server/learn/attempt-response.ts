import { applyLearnAttempt, parseLearnAttempt, type PlanAttemptRecord } from "../../learn/attempts.ts";
import { normalizeLearnProgress } from "../../learn/plan-progress.ts";
import type { Project } from "../../projects.ts";

type Owned = { userId: string } | Response;

export type LearnAttemptDeps = {
  owned: Owned;
  /** Called only after auth succeeds. A throw is treated as a body that is not JSON. */
  readBody: () => Promise<unknown>;
  loadProject: () => Promise<Project | null>;
  loadPlanMastery: () => Promise<Record<string, unknown>>;
  saveProject: (project: Project) => Promise<void>;
  savePlanAttempt: (record: PlanAttemptRecord) => Promise<void>;
  now?: number;
};

function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Could not save attempt.";
  return Response.json({ error: message }, { status: 500 });
}

function lessonIsKnown(project: Project | null, lessonId: string): boolean {
  const lessons = project?.learnPlan?.lessons;
  if (!Array.isArray(lessons) || lessons.length === 0) return true;
  return lessons.some((lesson) => lesson?.id === lessonId);
}

/**
 * POST /api/learn/plans/[planId]/attempts.
 * ownedPlan's Response (401, 404, 400, 503) is returned without touching storage.
 */
export async function handleLearnAttempt(deps: LearnAttemptDeps): Promise<Response> {
  if (deps.owned instanceof Response) return deps.owned;

  let body: unknown;
  try {
    body = await deps.readBody();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseLearnAttempt(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const attempt = parsed.attempt;

  try {
    const project = await deps.loadProject();
    if ((attempt.target === "lesson" || attempt.target === "review") && attempt.lessonId && !lessonIsKnown(project, attempt.lessonId)) {
      return Response.json({ error: "Unknown lesson." }, { status: 400 });
    }

    const planMastery = normalizeLearnProgress({ conceptMastery: await deps.loadPlanMastery() }).conceptMastery;
    const base = normalizeLearnProgress(project?.learnProgress ?? {});
    for (const [id, row] of Object.entries(planMastery)) {
      if (!base.conceptMastery[id]) base.conceptMastery[id] = row;
    }
    const next = applyLearnAttempt(base, attempt);
    const at = deps.now ?? Date.now();
    if (project) {
      // Stay ahead of the row we just read so a slower timestamp cannot drop the attempt.
      const updatedAt = Math.max(project.updatedAt + 1, at);
      await deps.saveProject({ ...project, learnProgress: next, updatedAt });
    }
    await deps.savePlanAttempt({
      at,
      target: attempt.target,
      ...(attempt.lessonId ? { lessonId: attempt.lessonId } : {}),
      answers: attempt.answers,
      conceptMastery: next.conceptMastery,
    });
    return Response.json({ conceptMastery: next.conceptMastery });
  } catch (error) {
    return failure(error);
  }
}

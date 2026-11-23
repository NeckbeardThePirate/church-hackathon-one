import { parseLearnAttempt, type LearnAttempt, type StoredLearnAttempt } from "../../learn/attempts.ts";
import type { ConceptMastery } from "../../learn/plan-progress.ts";

type Owned = { userId: string } | Response;

export type AttemptPreview = { ok: true } | { ok: false; error: string };

export type LearnAttemptDeps = {
  owned: Owned;
  /** Called only after auth succeeds. A throw is treated as a body that is not JSON. */
  readBody: () => Promise<unknown>;
  /** Read the current project and reject an unknown lesson before any write. */
  previewAttempt: (attempt: LearnAttempt) => Promise<AttemptPreview>;
  /** Merge mastery inside the plan DO and return that map. */
  recordPlanAttempt: (record: StoredLearnAttempt) => Promise<Record<string, ConceptMastery>>;
  /**
   * Re-read the workspace project at call time and patch only this quiz plus the plan mastery.
   * Must not write a project snapshot captured before recordPlanAttempt.
   */
  mirrorAttempt: (input: {
    attempt: LearnAttempt;
    conceptMastery: Record<string, ConceptMastery>;
    now: number;
  }) => Promise<AttemptPreview>;
  now?: number;
};

function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Could not save attempt.";
  return Response.json({ error: message }, { status: 500 });
}

/**
 * POST /api/learn/plans/[planId]/attempts.
 * ownedPlan's Response (401, 404, 400, 503) is returned without touching storage.
 * The plan DO's merged mastery is the response. The workspace write happens after that
 * await and only patches the current project row.
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
    const preview = await deps.previewAttempt(attempt);
    if (!preview.ok) return Response.json({ error: preview.error }, { status: 400 });

    const now = deps.now ?? Date.now();
    const conceptMastery = await deps.recordPlanAttempt({
      at: now,
      target: attempt.target,
      ...(attempt.lessonId ? { lessonId: attempt.lessonId } : {}),
      ...(parsed.timeZone ? { timeZone: parsed.timeZone } : {}),
      answers: attempt.answers,
    });
    const mirrored = await deps.mirrorAttempt({ attempt, conceptMastery, now });
    if (!mirrored.ok) return Response.json({ error: mirrored.error }, { status: 400 });
    return Response.json({ conceptMastery });
  } catch (error) {
    return failure(error);
  }
}

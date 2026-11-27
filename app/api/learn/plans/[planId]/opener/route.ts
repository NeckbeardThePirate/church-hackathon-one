import { parseOpenerAction, presentOpener, type OpenerSteer } from "@/app/lib/learn/opener";
import { learnEnv, ownedPlan } from "@/app/lib/server/learn/api";
import { runOpenerAction } from "@/app/lib/server/learn/opener-quiz";
import { enqueue, enqueueMany, type LearnEnv } from "@/app/lib/server/learn/queues";

export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" };

/** Current opener question, if the check is still open. Does not call a model. */
export async function GET(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const { planId } = await context.params;
  const owned = await ownedPlan(request, planId);
  if (owned instanceof Response) return owned;
  try {
    const state = await owned.stub.getOpener();
    return Response.json(presentOpener(state, state.generating), { headers: PRIVATE });
  } catch (error) {
    console.warn("[learn] opener read failed:", error instanceof Error ? error.message : error);
    return Response.json(presentOpener({ status: "closed", reason: "unavailable", questions: [], answers: [], diagnostic: { strengths: [], gaps: [] }, generating: false }), {
      headers: PRIVATE,
    });
  }
}

/**
 * Ask the next opener question, record an answer, or skip.
 * The path build is already running. This route never fails the plan.
 */
export async function POST(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const { planId } = await context.params;
  const owned = await ownedPlan(request, planId);
  if (owned instanceof Response) return owned;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseOpenerAction(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const env = learnEnv();
    const result = await runOpenerAction(env, owned.stub, parsed.action);
    await dispatchSteer(env, owned.stub, planId, result.steer);
    return Response.json(result.body, { headers: PRIVATE });
  } catch (error) {
    console.warn("[learn] opener action failed:", error instanceof Error ? error.message : error);
    return Response.json(
      presentOpener({ status: "closed", reason: "unavailable", questions: [], answers: [], diagnostic: { strengths: [], gaps: [] }, generating: false }),
      { headers: PRIVATE },
    );
  }
}

async function dispatchSteer(
  env: LearnEnv,
  stub: { abandonUnqueuedLessons(ids: string[]): Promise<OpenerSteer> },
  planId: string,
  steer: OpenerSteer,
): Promise<void> {
  if (steer.researchIds.length) {
    try {
      await enqueueMany(
        env,
        steer.researchIds.map((lessonId) => ({ planId, stage: "research" as const, lessonId, round: steer.round })),
      );
    } catch (error) {
      console.warn("[learn] opener lesson enqueue failed:", error instanceof Error ? error.message : error);
      const released = await stub.abandonUnqueuedLessons(steer.researchIds).catch(() => null);
      if (released?.critic) await enqueueCritic(env, planId, released.round);
      return;
    }
  }
  if (steer.critic) await enqueueCritic(env, planId, steer.round);
}

async function enqueueCritic(env: LearnEnv, planId: string, round: number): Promise<void> {
  try {
    await enqueue(env, { planId, stage: "critic", round });
  } catch (error) {
    console.warn("[learn] opener critic enqueue failed:", error instanceof Error ? error.message : error);
  }
}

import { parseGapRequest } from "../../../../../lib/learn/gaps.ts";
import { ownedPlan, learnEnv } from "../../../../../lib/server/learn/api.ts";
import { enqueue } from "../../../../../lib/server/learn/queues.ts";

export const dynamic = "force-dynamic";

/**
 * Queue one practice lesson for concepts missed on a core lesson.
 * Auth and ownership match the other plan routes. Caps live on the plan DO.
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
  const parsed = parseGapRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  let reserved: Awaited<ReturnType<typeof owned.stub.reserveGap>>;
  try {
    reserved = await owned.stub.reserveGap(parsed.request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the practice lesson.";
    return Response.json({ error: message }, { status: 500 });
  }
  if (!reserved.queued || !reserved.lessonId) {
    const status = reserved.error === "Unknown lesson." ? 400 : 200;
    return Response.json(reserved, { status });
  }

  try {
    await enqueue(learnEnv(), {
      planId,
      stage: "teach",
      lessonId: reserved.lessonId,
      round: 0,
      job: "gap",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the practice lesson.";
    await owned.stub.abandonGap(reserved.lessonId, "Could not start the practice lesson. The rest of the path is unchanged.").catch(() => {});
    return Response.json({ error: message }, { status: 500 });
  }

  return Response.json(reserved);
}

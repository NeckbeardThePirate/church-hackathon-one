import { ownedPlan } from "@/app/lib/server/learn/api";

export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * Plan status. `?view=roster` is the poll payload (ids and counts, no lesson bodies).
 * `?view=plan` is the lesson payload without the SSE progress log.
 * The default response still includes the progress log.
 */
export async function GET(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const { planId } = await context.params;
  const owned = await ownedPlan(request, planId);
  if (owned instanceof Response) return owned;
  const view = new URL(request.url).searchParams.get("view");
  if (view === "roster") {
    return Response.json(
      {
        status: owned.info.status,
        stage: owned.info.stage,
        lessonIds: owned.info.lessonIds,
        lessonsDone: owned.info.lessonsDone,
        lessonsTotal: owned.info.lessonsTotal,
      },
      { headers: PRIVATE },
    );
  }
  const snap = await owned.stub.snapshot(view === "plan" ? { events: false } : undefined);
  return Response.json(snap, { headers: PRIVATE });
}

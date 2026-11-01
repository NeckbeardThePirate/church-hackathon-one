import { ownedPlan } from "@/app/lib/server/learn/api";

export const dynamic = "force-dynamic";

/** Plan status + events; includes the full plan once complete or partial. */
export async function GET(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const { planId } = await context.params;
  const owned = await ownedPlan(request, planId);
  if (owned instanceof Response) return owned;
  return Response.json(await owned.stub.snapshot());
}

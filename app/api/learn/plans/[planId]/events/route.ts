import { ownedPlan } from "@/app/lib/server/learn/api";

export const dynamic = "force-dynamic";

/** SSE progress stream, proxied from the plan's Durable Object. Resumes via Last-Event-ID. */
export async function GET(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const { planId } = await context.params;
  const owned = await ownedPlan(request, planId);
  if (owned instanceof Response) return owned;

  const after = new URL(request.url).searchParams.get("after") ?? request.headers.get("last-event-id") ?? "0";
  return owned.stub.fetch(`https://learn-plan/events?after=${encodeURIComponent(after)}`, {
    signal: request.signal,
  });
}

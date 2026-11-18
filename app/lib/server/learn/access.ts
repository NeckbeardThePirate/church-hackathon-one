/** Same 404 for a missing plan and a plan owned by someone else. */
export function unownedPlanResponse(
  userId: string,
  info: { userId: string } | null | undefined,
): Response | null {
  if (!info || info.userId !== userId) return Response.json({ error: "Plan not found" }, { status: 404 });
  return null;
}

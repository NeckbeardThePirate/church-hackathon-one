/** Display catalog for the empty-workspace starter card. Safe for the client. */

export const STARTER_PATHS = [
  {
    id: "john",
    title: "The Gospel of John",
    detail: "The Word with God and made flesh, a practice lesson on that claim, and why the signs were written.",
  },
  {
    id: "lords-prayer",
    title: "The Lord’s Prayer",
    detail: "Matthew and Luke side by side, with a practice lesson on the lines they share and the lines Luke omits.",
  },
] as const;

export type StarterPathId = (typeof STARTER_PATHS)[number]["id"];

/** Stable plan ids. These paths are stored on the workspace, not on a Learn plan object. */
export const STARTER_PLAN_IDS: Record<StarterPathId, string> = {
  john: "33333333-3333-4333-8333-333333333333",
  "lords-prayer": "22222222-2222-4222-8222-222222222222",
};

/**
 * Plan ids copied into workspaces before a starter left the catalog.
 * Opening one still skips a live plan refresh: the path was stored whole, and no plan object was created.
 * The Book of Ruth used the first id.
 */
export const LEGACY_STARTER_PLAN_IDS = ["11111111-1111-4111-8111-111111111111"] as const;

export function isStarterPathId(value: unknown): value is StarterPathId {
  return typeof value === "string" && STARTER_PATHS.some((item) => item.id === value);
}

export function isStarterPlanId(planId: string): boolean {
  return (
    (Object.values(STARTER_PLAN_IDS) as string[]).includes(planId) ||
    (LEGACY_STARTER_PLAN_IDS as readonly string[]).includes(planId)
  );
}

/** Display catalog for the empty-workspace starter card. Safe for the client. */

export const STARTER_PATHS = [
  {
    id: "ruth",
    title: "The Book of Ruth",
    detail: "Loyalty on the road home, refuge under the wings, and a practice lesson on Ruth’s vow.",
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
  ruth: "11111111-1111-4111-8111-111111111111",
  "lords-prayer": "22222222-2222-4222-8222-222222222222",
};

export function isStarterPathId(value: unknown): value is StarterPathId {
  return typeof value === "string" && STARTER_PATHS.some((item) => item.id === value);
}

export function isStarterPlanId(planId: string): boolean {
  return (Object.values(STARTER_PLAN_IDS) as string[]).includes(planId);
}

import {
  parseLearnerStatsPut,
  StatsInputError,
  type LearnerStats,
  type LearnerStatsPatch,
} from "./user-workspace-schema.ts";

type Auth = { userId: string } | Response;

function failure(error: unknown, fallback: string): Response {
  const message = error instanceof Error ? error.message : fallback;
  return Response.json({ error: message }, { status: 500 });
}

/** GET /api/workspace/stats. An auth Response is returned as-is and read is not called. */
export async function handleStatsGet(auth: Auth, read: () => Promise<LearnerStats> | LearnerStats): Promise<Response> {
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await read());
  } catch (error) {
    return failure(error, "Could not load stats.");
  }
}

/**
 * PUT /api/workspace/stats. Invalid bodies are rejected before write.
 * XP, streak, and the award log are not taken from the client. A stale snapshot
 * cannot lower or duplicate them. Timezone is the field this route still stores.
 */
export async function handleStatsPut(
  auth: Auth,
  body: unknown,
  write: (patch: LearnerStatsPatch) => Promise<LearnerStats> | LearnerStats,
): Promise<Response> {
  if (auth instanceof Response) return auth;
  const parsed = parseLearnerStatsPut(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const patch: LearnerStatsPatch = {};
  if ("timezone" in parsed.patch) patch.timezone = parsed.patch.timezone;
  try {
    return Response.json(await write(patch));
  } catch (error) {
    return failure(error, "Could not save stats.");
  }
}

/** POST /api/workspace/stats/award. Amounts are chosen on the server and each reason pays once. */
export async function handleStatsAward(
  auth: Auth,
  body: unknown,
  now: number,
  award: (input: unknown, now: number) => Promise<LearnerStats> | LearnerStats,
): Promise<Response> {
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await award(body, now));
  } catch (error) {
    if (error instanceof StatsInputError) return Response.json({ error: error.message }, { status: 400 });
    return failure(error, "Could not save XP.");
  }
}

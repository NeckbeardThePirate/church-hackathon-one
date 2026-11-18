import { parseLearnerStatsPut, type LearnerStats, type LearnerStatsPatch } from "./user-workspace-schema.ts";

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

/** PUT /api/workspace/stats. Invalid bodies are rejected before write. */
export async function handleStatsPut(
  auth: Auth,
  body: unknown,
  write: (patch: LearnerStatsPatch) => Promise<LearnerStats> | LearnerStats,
): Promise<Response> {
  if (auth instanceof Response) return auth;
  const parsed = parseLearnerStatsPut(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    return Response.json(await write(parsed.patch));
  } catch (error) {
    return failure(error, "Could not save stats.");
  }
}

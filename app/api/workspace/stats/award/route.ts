import { requireUser } from "../../../../lib/server/clerk-auth.ts";
import { userWorkspaceStub } from "../../../../lib/server/user-workspace.ts";
import { handleStatsAward } from "../../../../lib/server/workspace-stats.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  let body: unknown = null;
  if (!(auth instanceof Response)) {
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON." }, { status: 400 });
    }
  }
  return handleStatsAward(auth, body, Date.now(), (input, now) => {
    if (auth instanceof Response) throw new Error("Sign in required.");
    return userWorkspaceStub(auth.userId).awardLearnerStats(input, now);
  });
}

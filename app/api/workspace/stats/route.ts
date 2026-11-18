import { requireUser } from "@/app/lib/server/clerk-auth";
import { userWorkspaceStub } from "@/app/lib/server/user-workspace";
import { handleStatsGet, handleStatsPut } from "@/app/lib/server/workspace-stats";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  return handleStatsGet(auth, () => {
    if (auth instanceof Response) throw new Error("Sign in required.");
    return userWorkspaceStub(auth.userId).getLearnerStats();
  });
}

export async function PUT(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  let body: unknown = null;
  if (!(auth instanceof Response)) {
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON." }, { status: 400 });
    }
  }
  return handleStatsPut(auth, body, (stats) => {
    if (auth instanceof Response) throw new Error("Sign in required.");
    return userWorkspaceStub(auth.userId).setLearnerStats(stats);
  });
}

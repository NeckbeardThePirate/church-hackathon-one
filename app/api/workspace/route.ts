import { requireUser } from "@/app/lib/server/clerk-auth";
import { userWorkspaceStub } from "@/app/lib/server/user-workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const projects = await userWorkspaceStub(auth.userId).listProjects();
    return Response.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load workspace.";
    return Response.json({ error: message }, { status: 500 });
  }
}

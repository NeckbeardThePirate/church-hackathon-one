import { requireUser } from "@/app/lib/server/clerk-auth";
import { userWorkspaceStub } from "@/app/lib/server/user-workspace";
import type { Project } from "@/app/lib/projects";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };

function idsMatch(urlId: string, bodyId: string): boolean {
  return urlId === bodyId && urlId.length > 0 && urlId.length <= 80;
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as { project?: Project };
    if (!body.project || !idsMatch(projectId, body.project.id)) {
      return Response.json({ error: "Project id mismatch." }, { status: 400 });
    }
    const saved = await userWorkspaceStub(auth.userId).upsertProject(body.project);
    return Response.json({ project: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save project.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const { projectId } = await context.params;
    if (!projectId || projectId.length > 80) {
      return Response.json({ error: "Invalid project id." }, { status: 400 });
    }
    await userWorkspaceStub(auth.userId).deleteProject(projectId);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete project.";
    return Response.json({ error: message }, { status: 500 });
  }
}

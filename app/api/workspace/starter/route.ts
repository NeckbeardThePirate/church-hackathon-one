import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { seedStarterIntoWorkspace } from "@/app/lib/server/starter-paths";
import { userWorkspaceStub } from "@/app/lib/server/user-workspace";
import type { LibraryEnv } from "@/app/lib/server/library-search";

export const dynamic = "force-dynamic";

/** Copy a finished starter path into the signed-in workspace. No model call. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const starterId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "john";
    const libraryEnv = env as unknown as LibraryEnv;
    const result = await seedStarterIntoWorkspace(userWorkspaceStub(auth.userId), libraryEnv, starterId, Date.now());
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(
      { project: result.project, created: result.created },
      { status: result.created ? 201 : 200, headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open the starter path.";
    return Response.json({ error: message }, { status: 500 });
  }
}

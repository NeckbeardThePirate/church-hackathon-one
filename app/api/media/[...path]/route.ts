import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { mediaKeyForUser, mediaKeyProjectId, parseMediaKeyFromPath } from "@/app/lib/server/media-keys";
import { userWorkspaceStub } from "@/app/lib/server/user-workspace";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { path } = await context.params;
  const key = parseMediaKeyFromPath(path);
  if (!key || !mediaKeyForUser(key, auth.userId)) {
    return new Response("Not found", { status: 404 });
  }

  // Legacy keys are not user-prefixed. Allow them only when this user's workspace owns the project.
  if (key.startsWith("projects/")) {
    const projectId = mediaKeyProjectId(key);
    const owns = projectId ? await userWorkspaceStub(auth.userId).ownsProject(projectId) : false;
    if (!owns) return new Response("Not found", { status: 404 });
  }

  if (!env.MEDIA) {
    return new Response("Storage unavailable", { status: 503 });
  }

  const object = await env.MEDIA.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("etag", object.httpEtag);

  return new Response(object.body, { headers });
}

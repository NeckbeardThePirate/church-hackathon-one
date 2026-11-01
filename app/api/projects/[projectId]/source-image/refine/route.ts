import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { assertProjectId, keyBelongsToProject } from "@/app/lib/server/media-keys";
import { runRefineOcrFromBytes } from "@/app/lib/server/refine-ocr";
import { PROJECT_KIND_LABEL, type ProjectKind } from "@/app/lib/projects";

export const dynamic = "force-dynamic";

const REFINE_TIMEOUT_MS = 120_000;

function isProjectKind(value: string): value is ProjectKind {
  return value === "lesson" || value === "study" || value === "learn";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const { projectId } = await context.params;
    assertProjectId(projectId);

    if (!env.MEDIA) {
      return Response.json({ error: "Storage binding MEDIA is unavailable." }, { status: 503 });
    }
    if (!env.AI) {
      return Response.json({ error: "Workers AI binding is unavailable." }, { status: 503 });
    }

    const body = (await request.json()) as { key?: string; rawOcrText?: string; kind?: string };
    const key = body.key;
    const rawOcrText = body.rawOcrText?.trim() ?? "";
    const kind = body.kind && isProjectKind(body.kind) ? body.kind : "study";

    if (!key || !keyBelongsToProject(key, auth.userId, projectId)) {
      return Response.json({ error: "Invalid image key" }, { status: 400 });
    }
    if (!rawOcrText) {
      return Response.json({ error: "rawOcrText is required" }, { status: 400 });
    }

    const object = await env.MEDIA.get(key);
    if (!object) {
      return Response.json({ error: "Image not found" }, { status: 404 });
    }

    const bytes = new Uint8Array(await object.arrayBuffer());
    const contentType = object.httpMetadata?.contentType ?? "image/jpeg";
    const noteKind = PROJECT_KIND_LABEL[kind];

    const refinePromise = runRefineOcrFromBytes(env.AI, bytes, contentType, rawOcrText, noteKind);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Structuring timed out after 2 minutes")), REFINE_TIMEOUT_MS);
    });

    try {
      const refined = await Promise.race([refinePromise, timeoutPromise]);
      return Response.json({
        title: refined.title,
        blocks: refined.blocks,
        plainText: refined.plainText,
      });
    } catch (error) {
      const refineError = error instanceof Error ? error.message : "Structuring failed";
      return Response.json({ refineError, plainText: rawOcrText, blocks: [] });
    }
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "Structuring failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

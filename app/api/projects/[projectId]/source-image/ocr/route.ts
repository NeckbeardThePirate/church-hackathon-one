import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { assertProjectId, keyBelongsToProject } from "@/app/lib/server/media-keys";
import { runImageOcrFromBytes } from "@/app/lib/server/ocr";

export const dynamic = "force-dynamic";

const OCR_TIMEOUT_MS = 120_000;

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

    const body = (await request.json()) as { key?: string };
    const key = body.key;
    if (!key || !keyBelongsToProject(key, auth.userId, projectId)) {
      return Response.json({ error: "Invalid image key" }, { status: 400 });
    }

    const object = await env.MEDIA.get(key);
    if (!object) {
      return Response.json({ error: "Image not found" }, { status: 404 });
    }

    const bytes = new Uint8Array(await object.arrayBuffer());
    const contentType = object.httpMetadata?.contentType ?? "image/jpeg";

    const ocrPromise = runImageOcrFromBytes(env.AI, bytes, contentType);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("OCR timed out after 2 minutes")), OCR_TIMEOUT_MS);
    });

    let extractedText = "";
    let ocrError: string | undefined;

    try {
      extractedText = await Promise.race([ocrPromise, timeoutPromise]);
    } catch (error) {
      ocrError = error instanceof Error ? error.message : "OCR failed";
    }

    return Response.json({
      extractedText,
      ocrError,
      empty: !extractedText && !ocrError,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "OCR failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

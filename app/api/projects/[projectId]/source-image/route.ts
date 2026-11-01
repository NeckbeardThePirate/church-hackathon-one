import { env } from "cloudflare:workers";
import { withAuth } from "@/app/lib/server/clerk-auth";
import {
  ALLOWED_IMAGE_TYPES,
  assertProjectId,
  isSafeMediaKey,
  MAX_IMAGE_BYTES,
  sourceImageKey,
} from "@/app/lib/server/media-keys";

export const dynamic = "force-dynamic";

function extensionForType(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  return withAuth(request, async (auth) => {
  try {
    const { projectId } = await context.params;
    assertProjectId(projectId);

    if (!env.MEDIA) {
      return Response.json(
        { error: "Storage binding MEDIA is unavailable. Restart dev after enabling remote R2." },
        { status: 503 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Missing image file" }, { status: 400 });
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return Response.json({ error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF." }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: "Image must be 10 MB or smaller." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileId = `${crypto.randomUUID()}.${extensionForType(file.type)}`;
    const key = sourceImageKey(auth.userId, projectId, fileId);

    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        originalName: file.name.slice(0, 200),
      },
    });

    return Response.json({
      key,
      contentType: file.type,
      fileName: file.name,
      imageUrl: `/api/media/${key}`,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "Upload failed";
    return Response.json({ error: message }, { status: 500 });
  }
  });
}

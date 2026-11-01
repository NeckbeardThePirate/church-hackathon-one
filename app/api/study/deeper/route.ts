import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { runGoDeeper } from "@/app/lib/server/go-deeper";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    if (!env.AI) {
      return Response.json({ error: "Workers AI binding is unavailable." }, { status: 503 });
    }
    const body = (await request.json()) as { text?: string };
    const text = body.text?.trim() ?? "";
    if (text.length < 3) {
      return Response.json({ error: "Add some text to this block first." }, { status: 400 });
    }
    const result = await runGoDeeper({ AI: env.AI, BIBLE: env.BIBLE, SCRIPTURE_VECTORS: env.SCRIPTURE_VECTORS, LIBRARY_VECTORS: env.LIBRARY_VECTORS }, text);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Go deeper failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

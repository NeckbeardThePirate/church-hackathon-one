import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { streamDeeperChat, type DeeperChatInput } from "@/app/lib/server/deeper-chat";

export const dynamic = "force-dynamic";

/** POST → streamed plain-text explanation (no messages) or chat reply (with messages). */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    if (!env.AI) return Response.json({ error: "Workers AI binding is unavailable." }, { status: 503 });
    const body = (await request.json()) as DeeperChatInput;
    if (!body.blockText?.trim()) return Response.json({ error: "blockText is required" }, { status: 400 });
    const stream = await streamDeeperChat(env.AI, body);
    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Chat failed" }, { status: 500 });
  }
}

import { env } from "cloudflare:workers";
import type { LearnChatInput } from "@/app/lib/learn/agent-context";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { streamLearnChat } from "@/app/lib/server/learn-chat";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    if (!env.AI) return Response.json({ error: "Workers AI binding is unavailable." }, { status: 503 });
    const body = (await request.json()) as LearnChatInput;
    if (!body.context?.planId?.trim()) return Response.json({ error: "context.planId is required" }, { status: 400 });
    const last = body.messages?.at(-1);
    if (!last || last.role !== "user" || !last.content?.trim()) {
      return Response.json({ error: "messages must end with a non-empty user message" }, { status: 400 });
    }
    const stream = await streamLearnChat(env.AI, body);
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

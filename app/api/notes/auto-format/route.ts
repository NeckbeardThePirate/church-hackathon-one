import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { runAutoFormat, type AutoFormatScope } from "@/app/lib/server/auto-format";

export const dynamic = "force-dynamic";

const AUTO_FORMAT_TIMEOUT_MS = 90_000;

function isScope(value: unknown): value is AutoFormatScope {
  return value === "document" || value === "block" || value === "selection";
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    if (!env.AI) {
      return jsonError("Workers AI binding is unavailable.", 503);
    }

    let body: { text?: string; scope?: string; noteKind?: string };
    try {
      body = (await request.json()) as { text?: string; scope?: string; noteKind?: string };
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const text = body.text?.trim() ?? "";
    if (text.length < 1) {
      return jsonError("Nothing to format.", 400);
    }

    const scope = isScope(body.scope) ? body.scope : "selection";

    const result = await Promise.race([
      runAutoFormat(env.AI, text, scope, body.noteKind),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Auto format timed out. Try a smaller selection.")), AUTO_FORMAT_TIMEOUT_MS);
      }),
    ]);

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto format failed";
    return jsonError(message, 500);
  }
}

import { env } from "cloudflare:workers";
import { applySession, devAuthAllowed, resolveSessionSecret } from "@/app/lib/server/session";

export const dynamic = "force-dynamic";

/** Loopback-only sign-in for local development. Refuses every other host. */
export async function POST(request: Request): Promise<Response> {
  if (!devAuthAllowed(request, env.DEV_AUTH)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const secret = resolveSessionSecret(request, env.SESSION_SECRET);
  if (!secret) return Response.json({ error: "Session secret is not configured." }, { status: 503 });
  return applySession(Response.json({ ok: true }), request, { userId: "dev_local", provider: "dev", compute: false }, secret);
}

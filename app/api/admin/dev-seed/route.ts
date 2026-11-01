import { env } from "cloudflare:workers";
import { seedLocalCitations } from "@/app/lib/server/dev-seed";
import { devAuthAllowed } from "@/app/lib/server/session";

export const dynamic = "force-dynamic";

/** Loopback-only sample so local plans can cite Romans 3, Westminster, and Chrysostom. */
export async function POST(request: Request): Promise<Response> {
  if (!devAuthAllowed(request, env.DEV_AUTH)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  if (!env.BIBLE) return Response.json({ error: "BIBLE binding is unavailable." }, { status: 503 });
  try {
    const result = await seedLocalCitations(env.BIBLE);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seed failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { matchVerseTextInD1 } from "@/app/lib/server/match-verse-text";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    if (!env.BIBLE) {
      return Response.json(
        { error: "Bible database (D1) is unavailable. Run npm run bible:migrate && npm run bible:seed." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { text?: string };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 24) {
      return Response.json({ error: "text is too short" }, { status: 400 });
    }

    const passage = await matchVerseTextInD1(env.BIBLE, text);
    if (!passage) {
      return Response.json({ match: null });
    }

    return Response.json({ match: passage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verse match failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

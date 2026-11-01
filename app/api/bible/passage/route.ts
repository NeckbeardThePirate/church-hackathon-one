import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { fetchPassageFromD1 } from "@/app/lib/server/bible-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    if (!env.BIBLE) {
      return Response.json(
        { error: "Bible database (D1) is unavailable. Run npm run bible:migrate && npm run bible:seed." },
        { status: 503 },
      );
    }

    const url = new URL(request.url);
    const slug = url.searchParams.get("slug")?.toLowerCase();
    const chapter = Number(url.searchParams.get("chapter"));
    const start = Number(url.searchParams.get("start") ?? url.searchParams.get("verseStart"));
    const end = Number(url.searchParams.get("end") ?? url.searchParams.get("verseEnd") ?? start);

    if (!slug || !Number.isFinite(chapter) || !Number.isFinite(start)) {
      return Response.json({ error: "Required: slug, chapter, start" }, { status: 400 });
    }

    const passage = await fetchPassageFromD1(env.BIBLE, slug, chapter, start, end);
    if (!passage) {
      return Response.json({ error: "Passage not found in BSB database" }, { status: 404 });
    }

    return Response.json(passage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passage lookup failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

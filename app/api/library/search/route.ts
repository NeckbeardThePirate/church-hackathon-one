import { env } from "cloudflare:workers";
import { requireUser } from "@/app/lib/server/clerk-auth";
import { findBibleReferences } from "@/app/lib/bible/parse-reference";
import { searchConfessions, searchFathers } from "@/app/lib/server/library-search";
import { searchScripture, type SearchMode } from "@/app/lib/server/scripture-search";

export const dynamic = "force-dynamic";

/** GET /api/library/search?corpus=scripture|fathers|confessions&q=…&mode=hybrid|semantic|text */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const corpus = url.searchParams.get("corpus") ?? "scripture";
    const modeParam = url.searchParams.get("mode");
    const mode: SearchMode = modeParam === "semantic" || modeParam === "text" ? modeParam : "hybrid";
    const k = Math.min(30, Math.max(1, Number(url.searchParams.get("k")) || 12));
    if (q.length < 2) return Response.json({ error: "q is required" }, { status: 400 });
    const refs = findBibleReferences(q);

    const hits =
      corpus === "fathers"
        ? await searchFathers(env, q, { k, refs, mode })
        : corpus === "confessions"
          ? await searchConfessions(env, q, { k, refs, mode })
          : await searchScripture(env, q, { k, mode });
    return Response.json({ query: q, corpus, mode, hits });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Search failed" }, { status: 500 });
  }
}

import { env } from "cloudflare:workers";
import { embedVersePage } from "@/app/lib/server/scripture-search";
import { embedLibraryPage } from "@/app/lib/server/library-search";

export const dynamic = "force-dynamic";

/**
 * Backfills verse embeddings into Vectorize, one page per call.
 * Driven by `npm run bible:embed`. Requires header x-admin-token = env.ADMIN_TOKEN,
 * or (when ADMIN_TOKEN is unset) a localhost request.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const adminToken = (env as { ADMIN_TOKEN?: string }).ADMIN_TOKEN;
  const authorized = adminToken
    ? request.headers.get("x-admin-token") === adminToken
    : url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!authorized) return Response.json({ error: "Forbidden" }, { status: 403 });

  if (!env.AI || !env.BIBLE || !env.SCRIPTURE_VECTORS || !env.LIBRARY_VECTORS) {
    return Response.json(
      { error: "AI, BIBLE, SCRIPTURE_VECTORS and LIBRARY_VECTORS bindings are required." },
      { status: 503 },
    );
  }
  try {
    const corpus = url.searchParams.get("corpus") ?? "verses";
    const after = Number(url.searchParams.get("after") ?? 0) || 0;
    const limit = Math.min(1000, Number(url.searchParams.get("limit")) || 500);
    const result =
      corpus === "fathers" || corpus === "confessions"
        ? await embedLibraryPage(
            { AI: env.AI, BIBLE: env.BIBLE, LIBRARY_VECTORS: env.LIBRARY_VECTORS },
            corpus,
            after,
            limit,
          )
        : await embedVersePage(
            { AI: env.AI, BIBLE: env.BIBLE, SCRIPTURE_VECTORS: env.SCRIPTURE_VECTORS },
            after,
            limit,
          );
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Embed failed" }, { status: 500 });
  }
}

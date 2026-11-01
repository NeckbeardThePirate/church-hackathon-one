import { env } from "cloudflare:workers";
import { ownedPlan } from "@/app/lib/server/learn/api";
import { loadArticleText } from "@/app/lib/server/learn/article-fetch";

export const dynamic = "force-dynamic";

/** Article text for the in-plan reader. The URL must already be on this plan. */
export async function POST(request: Request, context: { params: Promise<{ planId: string }> }): Promise<Response> {
  const { planId } = await context.params;
  const owned = await ownedPlan(request, planId);
  if (owned instanceof Response) return owned;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const url =
    body && typeof body === "object" && typeof (body as { url?: unknown }).url === "string"
      ? (body as { url: string }).url.trim()
      : "";
  if (!url || url.length > 2000) return Response.json({ error: "A valid article URL is required." }, { status: 400 });

  const snap = await owned.stub.snapshot();
  const fromPlan = snap.plan?.lessons ?? [];
  const lessons = fromPlan.some((lesson) => lesson.articles.length) ? fromPlan : await owned.stub.getLessons();
  const article = lessons.flatMap((lesson) => lesson.articles).find((item) => item.url === url);
  if (!article) return Response.json({ error: "That article is not part of this plan." }, { status: 404 });

  try {
    const text = await loadArticleText(
      {
        get: (key) => owned.stub.getScratch(key),
        put: (key, value) => owned.stub.putScratch(key, value),
      },
      env.EXA_API_KEY,
      article,
    );
    if (!text) {
      return Response.json(
        { error: "This article couldn't be loaded. Open it on the original site." },
        { status: 502 },
      );
    }
    return Response.json(text);
  } catch {
    return Response.json(
      { error: "This article couldn't be loaded. Open it on the original site." },
      { status: 502 },
    );
  }
}

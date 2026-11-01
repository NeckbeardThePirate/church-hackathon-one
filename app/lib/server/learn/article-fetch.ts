import { ARTICLE_TEXT_MAX, type FetchedArticle } from "@/app/lib/learn/article";
import { exaContents } from "./exa";
import { htmlToArticleText, publicArticleUrl } from "./readable-html";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Exa text this long is enough; skip the direct HTML fetch. */
const SOLID_CHARS = 800;

export type ArticleTextCache = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
};

async function cacheKey(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `article-text:${hex}`;
}

function readStored(value: unknown, url: string): FetchedArticle | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.v !== 1 || row.url !== url) return null;
  if (typeof row.text !== "string" || row.text.length < 80) return null;
  if (typeof row.fetchedAt !== "number" || Date.now() - row.fetchedAt > WEEK_MS) return null;
  return {
    url,
    title: typeof row.title === "string" ? row.title : "",
    author: typeof row.author === "string" && row.author ? row.author : undefined,
    siteName: typeof row.siteName === "string" && row.siteName ? row.siteName : undefined,
    text: row.text,
    truncated: row.truncated === true,
  };
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

async function fetchPublicHtml(start: string): Promise<string | null> {
  let current = start;
  for (let hop = 0; hop < 5; hop++) {
    if (!publicArticleUrl(current)) return null;
    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "user-agent": "ChurchHackathonArticleReader/1.0",
      },
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/.test(type)) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 1_500_000) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
  return null;
}

/**
 * Article body for the reading window. Uses a plan-DO cache, then Exa /contents,
 * then a direct HTML extract when Exa is missing or only returns a snippet.
 * Only call this with a URL already stored on the caller's plan.
 */
export async function loadArticleText(
  cache: ArticleTextCache,
  apiKey: string | undefined,
  article: { url: string; title: string; siteName?: string },
): Promise<FetchedArticle | null> {
  if (!publicArticleUrl(article.url)) return null;
  const url = article.url;
  const key = await cacheKey(url);
  const cached = readStored(await cache.get(key).catch(() => undefined), url);
  if (cached) return cached;

  let best: FetchedArticle | null = null;
  if (apiKey) {
    try {
      const exa = await exaContents(apiKey, url, ARTICLE_TEXT_MAX);
      if (exa?.text && exa.text.length >= 80) {
        best = {
          url,
          title: article.title || exa.title,
          author: exa.author,
          siteName: article.siteName || hostOf(url),
          text: exa.text,
          truncated: exa.text.length >= ARTICLE_TEXT_MAX - 32,
        };
      }
    } catch {
      /* Fall through to the HTML extract. */
    }
  }

  if (!best || best.text.length < SOLID_CHARS) {
    const html = await fetchPublicHtml(url);
    if (html) {
      const extracted = htmlToArticleText(html);
      if (extracted.text.length >= 80 && extracted.text.length > (best?.text.length ?? 0)) {
        best = {
          url,
          title: article.title || extracted.title || best?.title || url,
          author: best?.author,
          siteName: article.siteName || hostOf(url),
          text: extracted.text,
          truncated: extracted.truncated,
        };
      }
    }
  }

  if (!best) return null;
  await cache.put(key, { ...best, v: 1 as const, fetchedAt: Date.now() }).catch(() => undefined);
  return best;
}

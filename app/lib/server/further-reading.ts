import { env } from "cloudflare:workers";

export type ReadingKind = "article" | "video" | "search";

export type ReadingItem = {
  kind: ReadingKind;
  title: string;
  url: string;
  /** Display domain / site name. */
  source: string;
  description?: string;
  thumbnail?: string;
  age?: string;
};

/** Trusted sites for search-launcher fallback (always-valid URLs, never model-generated). */
const LAUNCHERS: { source: string; kind: ReadingKind; url: (q: string) => string }[] = [
  { source: "BibleProject", kind: "video", url: (q) => `https://bibleproject.com/search/?q=${encodeURIComponent(q)}` },
  { source: "YouTube", kind: "video", url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { source: "CCEL", kind: "article", url: (q) => `https://ccel.org/search?qu=${encodeURIComponent(q)}` },
  { source: "The Gospel Coalition", kind: "article", url: (q) => `https://www.thegospelcoalition.org/?s=${encodeURIComponent(q)}` },
  { source: "Ligonier", kind: "article", url: (q) => `https://www.ligonier.org/search?query=${encodeURIComponent(q)}` },
  { source: "Desiring God", kind: "article", url: (q) => `https://www.desiringgod.org/search?q=${encodeURIComponent(q)}` },
];

function braveKey(): string | undefined {
  const fromBinding = (env as { BRAVE_SEARCH_API_KEY?: string }).BRAVE_SEARCH_API_KEY;
  if (fromBinding?.trim()) return fromBinding.trim();
  return typeof process !== "undefined" ? process.env.BRAVE_SEARCH_API_KEY?.trim() || undefined : undefined;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const stripTags = (text?: string) => text?.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

type BraveWeb = { web?: { results?: { title: string; url: string; description?: string; age?: string; thumbnail?: { src?: string } }[] } };
type BraveVideos = {
  results?: { title: string; url: string; description?: string; age?: string; thumbnail?: { src?: string }; meta_url?: { hostname?: string } }[];
};

async function brave<T>(path: string, query: string, key: string, count: number): Promise<T | null> {
  const url = `https://api.search.brave.com/res/v1/${path}?q=${encodeURIComponent(query)}&count=${count}&safesearch=strict`;
  const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": key } });
  return res.ok ? ((await res.json()) as T) : null;
}

/**
 * Further reading for a block. Real results via Brave Search when BRAVE_SEARCH_API_KEY is set;
 * otherwise curated site-search links built from the model's suggested queries.
 */
export async function fetchFurtherReading(queries: string[]): Promise<ReadingItem[]> {
  const cleaned = [...new Set(queries.map((q) => q.trim()).filter((q) => q.length > 2))].slice(0, 3);
  if (!cleaned.length) return [];

  const key = braveKey();
  if (key) {
    try {
      const [primary, secondary] = cleaned;
      const [web, web2, videos] = await Promise.all([
        brave<BraveWeb>("web/search", `${primary} Christian theology`, key, 6),
        secondary ? brave<BraveWeb>("web/search", `${secondary} Bible`, key, 4) : Promise.resolve(null),
        brave<BraveVideos>("videos/search", `${primary} Bible`, key, 5),
      ]);
      const seen = new Set<string>();
      const items: ReadingItem[] = [];
      for (const r of [...(web?.web?.results ?? []), ...(web2?.web?.results ?? [])]) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        items.push({
          kind: /youtube\.com|youtu\.be|vimeo\.com/.test(r.url) ? "video" : "article",
          title: stripTags(r.title) ?? r.url,
          url: r.url,
          source: domain(r.url),
          description: stripTags(r.description),
          thumbnail: r.thumbnail?.src,
          age: r.age,
        });
      }
      for (const r of videos?.results ?? []) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        items.push({
          kind: "video",
          title: stripTags(r.title) ?? r.url,
          url: r.url,
          source: r.meta_url?.hostname?.replace(/^www\./, "") ?? domain(r.url),
          description: stripTags(r.description),
          thumbnail: r.thumbnail?.src,
          age: r.age,
        });
      }
      if (items.length) return items.slice(0, 12);
    } catch {
      // fall back to launchers
    }
  }

  const [primary] = cleaned;
  return [
    ...LAUNCHERS.map((site) => ({
      kind: "search" as const,
      title: primary!,
      url: site.url(primary!),
      source: site.source,
      description: site.kind === "video" ? "Videos" : "Articles",
    })),
    ...cleaned.slice(1).map((q) => ({
      kind: "search" as const,
      title: q,
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q} Bible`)}`,
      source: "YouTube",
      description: "Videos",
    })),
  ];
}

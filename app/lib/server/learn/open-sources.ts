/**
 * Free, keyless sources used when Exa is not configured.
 * Titles, URLs, and descriptions come from the APIs. Nothing here is model-written.
 */

export type OpenArticle = {
  url: string;
  title: string;
  text: string;
  siteName: string;
};

export type OpenBook = {
  url: string;
  title: string;
  authors: string[];
  year?: number;
  averageRating?: number;
  ratingsCount?: number;
};

/**
 * Topic first. Lesson search hints are written for a semantic index and are
 * often a single word ("introduction") that Wikipedia resolves to the wrong page.
 */
export function openSourceQueryOrder(topic: string, lessonTitle: string, hints: string[]): string[] {
  const ordered: string[] = [];
  for (const item of [topic, lessonTitle, ...hints]) {
    const query = item.trim();
    if (query.length < 3 || ordered.includes(query)) continue;
    ordered.push(query);
  }
  return ordered.slice(0, 4);
}

const HEADERS = {
  accept: "application/json",
  "user-agent": "StudyBuddy/0.1 (church study plan; contact: judah@hellands.com)",
};

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

export async function searchWikipedia(query: string, limit = 3): Promise<OpenArticle[]> {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json`;
  const payload = (await getJson(searchUrl)) as unknown[];
  const titles = Array.isArray(payload[1]) ? (payload[1] as unknown[]).filter((item): item is string => typeof item === "string") : [];
  const articles: OpenArticle[] = [];
  for (const title of titles.slice(0, limit)) {
    try {
      const summary = (await getJson(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      )) as { extract?: string; content_urls?: { desktop?: { page?: string } }; title?: string };
      const text = typeof summary.extract === "string" ? summary.extract.trim() : "";
      const url = summary.content_urls?.desktop?.page;
      if (!url || text.length < 80) continue;
      articles.push({ url, title: summary.title || title, text: text.slice(0, 3000), siteName: "wikipedia.org" });
    } catch (error) {
      console.warn("[learn] wikipedia summary skipped:", error instanceof Error ? error.message : error);
    }
  }
  return articles;
}

export async function searchOpenLibrary(query: string, limit = 2): Promise<OpenBook[]> {
  const payload = (await getJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=key,title,author_name,first_publish_year,ratings_average,ratings_count`,
  )) as {
    docs?: {
      key?: string;
      title?: string;
      author_name?: string[];
      first_publish_year?: number;
      ratings_average?: number;
      ratings_count?: number;
    }[];
  };
  const books: OpenBook[] = [];
  for (const doc of payload.docs ?? []) {
    if (!doc.key || !doc.title) continue;
    const book: OpenBook = {
      url: `https://openlibrary.org${doc.key}`,
      title: doc.title,
      authors: Array.isArray(doc.author_name) ? doc.author_name.slice(0, 4) : [],
    };
    if (typeof doc.first_publish_year === "number") book.year = doc.first_publish_year;
    if (typeof doc.ratings_average === "number") book.averageRating = doc.ratings_average;
    if (typeof doc.ratings_count === "number") book.ratingsCount = doc.ratings_count;
    books.push(book);
  }
  return books;
}

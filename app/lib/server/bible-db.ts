import { bookBySlug } from "../bible/books";
import { bibleGatewayEsvUrl } from "../bible/bible-gateway";

export type PassageVerse = {
  verse: number;
  text: string;
};

export type PassageResult = {
  reference: string;
  translation: "BSB";
  book: string;
  slug: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  verses: PassageVerse[];
  gatewayUrl: string;
  calloutHtml: string;
};

function stripFootnoteMarkers(text: string): string {
  return text.replace(/\d+:\d+\s/g, "").replace(/\s+/g, " ").trim();
}

const PASSAGE_SQL = `SELECT verse, text FROM bible_verses
       WHERE book_id = ? AND chapter = ? AND verse >= ? AND verse <= ?
       ORDER BY verse ASC`;

export type PassageQuery = {
  slug: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

/** One D1 round trip for every passage. A miss stays null and does not drop the others. */
export async function fetchPassagesFromD1(db: D1Database, refs: PassageQuery[]): Promise<(PassageResult | null)[]> {
  const out: (PassageResult | null)[] = refs.map(() => null);
  const jobs: { index: number; book: NonNullable<ReturnType<typeof bookBySlug>>; chapter: number; verseStart: number; end: number }[] = [];
  refs.forEach((ref, index) => {
    const book = bookBySlug(ref.slug);
    if (!book) return;
    jobs.push({
      index,
      book,
      chapter: ref.chapter,
      verseStart: ref.verseStart,
      end: Math.max(ref.verseStart, ref.verseEnd),
    });
  });
  if (!jobs.length) return out;

  const rows = await passageRows(db, jobs);
  rows.forEach((result, index) => {
    const job = jobs[index];
    if (!job || !result?.length) return;
    out[job.index] = passageFromRows(job.book, job.chapter, job.verseStart, job.end, result);
  });
  return out;
}

export async function fetchPassageFromD1(
  db: D1Database,
  slug: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): Promise<PassageResult | null> {
  const [passage] = await fetchPassagesFromD1(db, [{ slug, chapter, verseStart, verseEnd }]);
  return passage ?? null;
}

async function passageRows(
  db: D1Database,
  jobs: { book: { id: number }; chapter: number; verseStart: number; end: number }[],
): Promise<({ verse: number; text: string }[] | null)[]> {
  const statements = () =>
    jobs.map((job) => db.prepare(PASSAGE_SQL).bind(job.book.id, job.chapter, job.verseStart, job.end));
  if (typeof db.batch === "function") {
    try {
      const results = await db.batch<{ verse: number; text: string }>(statements());
      return results.map((result) => result.results ?? []);
    } catch {
      /* A failed batch must not drop every passage. */
    }
  }
  return Promise.all(
    statements().map(async (statement) => {
      try {
        const { results } = await statement.all<{ verse: number; text: string }>();
        return results ?? [];
      } catch {
        return null;
      }
    }),
  );
}

function passageFromRows(
  book: NonNullable<ReturnType<typeof bookBySlug>>,
  chapter: number,
  verseStart: number,
  end: number,
  results: { verse: number; text: string }[],
): PassageResult {
  const reference = end !== verseStart ? `${book.name} ${chapter}:${verseStart}–${end}` : `${book.name} ${chapter}:${verseStart}`;
  const verses = results.map((row) => ({
    verse: row.verse,
    text: stripFootnoteMarkers(row.text),
  }));
  const calloutHtml = verses.map((row) => `<p><sup>${row.verse}</sup> ${escapeHtml(row.text)}</p>`).join("");
  return {
    reference,
    translation: "BSB",
    book: book.name,
    slug: book.slug,
    chapter,
    verseStart,
    verseEnd: end,
    verses,
    gatewayUrl: bibleGatewayEsvUrl(reference),
    calloutHtml,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

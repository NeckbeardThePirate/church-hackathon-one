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

export async function fetchPassageFromD1(
  db: D1Database,
  slug: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): Promise<PassageResult | null> {
  const book = bookBySlug(slug);
  if (!book) return null;

  const end = Math.max(verseStart, verseEnd);
  const { results } = await db
    .prepare(
      `SELECT verse, text FROM bible_verses
       WHERE book_id = ? AND chapter = ? AND verse >= ? AND verse <= ?
       ORDER BY verse ASC`,
    )
    .bind(book.id, chapter, verseStart, end)
    .all<{ verse: number; text: string }>();

  if (!results?.length) return null;

  const reference =
    end !== verseStart ? `${book.name} ${chapter}:${verseStart}–${end}` : `${book.name} ${chapter}:${verseStart}`;

  const verses = results.map((row) => ({
    verse: row.verse,
    text: stripFootnoteMarkers(row.text),
  }));

  const calloutHtml = verses
    .map((row) => `<p><sup>${row.verse}</sup> ${escapeHtml(row.text)}</p>`)
    .join("");

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

import { BIBLE_BOOKS } from "../bible/books";
import { bibleGatewayEsvUrl } from "../bible/bible-gateway";
import { inputWordCoverage, scriptureTextsOverlap } from "../bible/scripture-text";
import type { PassageResult } from "./bible-db";

type VerseRow = { book_id: number; chapter: number; verse: number; text: string };

const bookById = new Map(BIBLE_BOOKS.map((book) => [book.id, book]));

const STOP = new Set(
  "the and for that with this from are was were but not you your his her its our their they them what when who will would have has had into unto upon shall than then there these those which also been being".split(
    " ",
  ),
);

function stripFootnoteMarkers(text: string): string {
  return text.replace(/\d+:\d+\s/g, "").replace(/\s+/g, " ").trim();
}

function toFtsQuery(query: string): string | null {
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9']+/g)
    ?.filter((term) => term.length > 2 && !STOP.has(term))
    .slice(0, 24);
  if (!terms?.length) return null;
  return [...new Set(terms)].map((term) => `"${term.replace(/"/g, "")}"`).join(" OR ");
}

async function ftsCandidates(db: D1Database, query: string, k: number): Promise<VerseRow[]> {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  const { results } = await db
    .prepare(
      `SELECT v.book_id, v.chapter, v.verse, v.text
       FROM bible_verses_fts f JOIN bible_verses v ON v.rowid = f.rowid
       WHERE bible_verses_fts MATCH ? ORDER BY bm25(bible_verses_fts) LIMIT ?`,
    )
    .bind(fts, k)
    .all<VerseRow>();
  return results ?? [];
}

async function loadVerseRange(
  db: D1Database,
  bookId: number,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): Promise<VerseRow[]> {
  if (verseEnd < verseStart) return [];
  const { results } = await db
    .prepare(
      `SELECT book_id, chapter, verse, text FROM bible_verses
       WHERE book_id = ? AND chapter = ? AND verse >= ? AND verse <= ?
       ORDER BY verse ASC`,
    )
    .bind(bookId, chapter, verseStart, verseEnd)
    .all<VerseRow>();
  return results ?? [];
}

function passageFromRows(rows: VerseRow[]): PassageResult | null {
  if (!rows.length) return null;
  const book = bookById.get(rows[0]!.book_id);
  if (!book) return null;

  const verses = rows.map((row) => ({
    verse: row.verse,
    text: stripFootnoteMarkers(row.text),
  }));

  const verseStart = verses[0]!.verse;
  const verseEnd = verses[verses.length - 1]!.verse;
  const reference =
    verseEnd !== verseStart ? `${book.name} ${rows[0]!.chapter}:${verseStart}–${verseEnd}` : `${book.name} ${rows[0]!.chapter}:${verseStart}`;

  const calloutHtml = verses
    .map((row) => `<p><sup>${row.verse}</sup> ${escapeHtml(row.text)}</p>`)
    .join("");

  return {
    reference,
    translation: "BSB",
    book: book.name,
    slug: book.slug,
    chapter: rows[0]!.chapter,
    verseStart,
    verseEnd,
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

function overlapScore(inputPlain: string, combined: string): number {
  if (!scriptureTextsOverlap(inputPlain, combined)) return 0;
  return inputWordCoverage(inputPlain, combined) + inputWordCoverage(combined, inputPlain);
}

/** Best contiguous verse span near a seed (partial clips and multi-verse chunks). */
async function bestSpanAroundSeed(
  db: D1Database,
  seed: VerseRow,
  inputPlain: string,
): Promise<VerseRow[]> {
  const windowStart = Math.max(1, seed.verse - 4);
  const windowEnd = seed.verse + 8;
  const window = await loadVerseRange(db, seed.book_id, seed.chapter, windowStart, windowEnd);
  if (!window.length) return [];

  let bestRows: VerseRow[] = [];
  let bestScore = 0;

  for (let start = 0; start < window.length; start++) {
    let combined = "";
    for (let end = start; end < window.length; end++) {
      const nextText = stripFootnoteMarkers(window[end]!.text);
      combined = combined ? `${combined} ${nextText}` : nextText;
      const score = overlapScore(inputPlain, combined);
      if (score > bestScore) {
        bestScore = score;
        bestRows = window.slice(start, end + 1);
      }
    }
  }

  return bestScore > 0 ? bestRows : [];
}

async function bestPassageForSeed(
  db: D1Database,
  seed: VerseRow,
  inputPlain: string,
): Promise<PassageResult | null> {
  const span = await bestSpanAroundSeed(db, seed, inputPlain);
  if (span.length) return passageFromRows(span);

  const cleaned = stripFootnoteMarkers(seed.text);
  if (scriptureTextsOverlap(inputPlain, cleaned)) return passageFromRows([seed]);

  return null;
}

/** Match pasted/written verse prose to BSB (FTS + fuzzy overlap). */
export async function matchVerseTextInD1(db: D1Database, inputPlain: string): Promise<PassageResult | null> {
  const trimmed = inputPlain.trim();
  if (trimmed.length < 24) return null;

  const candidates = await ftsCandidates(db, trimmed.slice(0, 500), 12);
  for (const seed of candidates) {
    const passage = await bestPassageForSeed(db, seed, trimmed);
    if (passage) return passage;
  }

  return null;
}

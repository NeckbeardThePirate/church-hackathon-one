import { BIBLE_BOOKS, bookByAlias, type BibleBook } from "./books";

export type ParsedBibleReference = {
  book: BibleBook;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  label: string;
  start: number;
  end: number;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBookPattern(): string {
  const names = new Set<string>();
  for (const book of BIBLE_BOOKS) {
    names.add(escapeRegExp(book.name));
    for (const alias of book.aliases) {
      names.add(escapeRegExp(alias));
    }
  }
  return [...names].sort((a, b) => b.length - a.length).join("|");
}

const BOOK_PATTERN = buildBookPattern();

const REFERENCE_REGEX = new RegExp(
  String.raw`\b((?:[1-3]\s*)?(?:${BOOK_PATTERN}))[\.\s]+(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[–—-]\s*(\d{1,3}))?\b`,
  "gi",
);

export function findBibleReferences(text: string): ParsedBibleReference[] {
  const results: ParsedBibleReference[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(REFERENCE_REGEX)) {
    const rawBook = match[1]?.trim();
    const chapter = Number(match[2]);
    const verseStart = Number(match[3]);
    const verseEnd = match[4] ? Number(match[4]) : verseStart;
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (!rawBook || !Number.isFinite(chapter) || !Number.isFinite(verseStart)) continue;

    const book = bookByAlias(rawBook.replace(/\s+/g, " "));
    if (!book) continue;

    const label =
      verseEnd !== verseStart
        ? `${book.name} ${chapter}:${verseStart}–${verseEnd}`
        : `${book.name} ${chapter}:${verseStart}`;

    const key = `${book.slug}:${chapter}:${verseStart}-${verseEnd}:${start}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      book,
      chapter,
      verseStart,
      verseEnd: Math.max(verseStart, verseEnd),
      label,
      start,
      end,
    });
  }

  return results.sort((a, b) => a.start - b.start);
}

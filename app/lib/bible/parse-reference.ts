import { BIBLE_BOOKS, BIBLE_CHAPTER_COUNT, bookByAlias, type BibleBook } from "./books.ts";

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

/** A passage the learner typed: a verse range, or a whole chapter (verseEnd = WHOLE_CHAPTER_END). */
export type PassageRef = {
  slug: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  label: string;
};

/** Upper bound used for whole-chapter lookups; the Bible DB query simply returns the verses that exist. */
export const WHOLE_CHAPTER_END = 200;
export const MAX_PASSAGES = 12;

const PASSAGE_BODY = String.raw`((?:[1-3]\s*)?(?:${BOOK_PATTERN}))[\.\s]+(\d{1,3})(?:\s*:\s*(\d{1,3})(?:\s*[–—-]\s*(\d{1,3}))?)?`;
const PASSAGE_REGEX = new RegExp(String.raw`^\s*${PASSAGE_BODY}\s*$`, "i");

/**
 * Parse one typed passage ("Romans 8:1-17", "John 3:16", "Psalm 23"). Returns null for anything that
 * is not exactly one reference to a real book and chapter.
 */
export function parsePassage(input: string): PassageRef | null {
  const match = PASSAGE_REGEX.exec(input.trim());
  if (!match) return null;
  const book = bookByAlias(match[1]!.replace(/\s+/g, " "));
  if (!book) return null;
  const chapter = Number(match[2]);
  const chapters = BIBLE_CHAPTER_COUNT[book.slug];
  if (!chapter || (chapters && chapter > chapters)) return null;
  if (match[3] === undefined) {
    return { slug: book.slug, chapter, verseStart: 1, verseEnd: WHOLE_CHAPTER_END, label: `${book.name} ${chapter}` };
  }
  const verseStart = Number(match[3]);
  const verseEnd = match[4] ? Number(match[4]) : verseStart;
  if (verseStart < 1 || verseEnd < verseStart) return null;
  const label = verseEnd !== verseStart ? `${book.name} ${chapter}:${verseStart}–${verseEnd}` : `${book.name} ${chapter}:${verseStart}`;
  return { slug: book.slug, chapter, verseStart, verseEnd, label };
}

/** Parse a list typed or pasted with `;` or newlines between passages. Duplicates collapse by label. */
export function parsePassageList(input: string): { passages: PassageRef[]; invalid: string[] } {
  const passages: PassageRef[] = [];
  const invalid: string[] = [];
  for (const part of input.split(/[;\n]+/)) {
    if (!part.trim()) continue;
    const ref = parsePassage(part);
    if (!ref) invalid.push(part.trim());
    else if (!passages.some((p) => p.label === ref.label)) passages.push(ref);
  }
  return { passages, invalid };
}

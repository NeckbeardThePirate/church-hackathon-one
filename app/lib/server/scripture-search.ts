import { BIBLE_BOOKS } from "../bible/books";

export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

type VerseRow = { book_id: number; chapter: number; verse: number; text: string };

const bookById = new Map(BIBLE_BOOKS.map((book) => [book.id, book]));

export function cleanVerseText(text: string): string {
  return text.replace(/\d+:\d+\s/g, "").replace(/\s+/g, " ").trim();
}

export function verseId(bookId: number, chapter: number, verse: number): string {
  return `${bookId}:${chapter}:${verse}`;
}

/** Text that gets embedded for a verse. Reference prefix helps book/topic queries. */
export function verseEmbeddingInput(row: VerseRow): string {
  const book = bookById.get(row.book_id);
  return `${book?.name ?? ""} ${row.chapter}:${row.verse} — ${cleanVerseText(row.text)}`;
}

export async function embedTexts(ai: Ai, texts: string[]): Promise<number[][]> {
  const result = (await ai.run(EMBED_MODEL, { text: texts })) as { data: number[][] };
  return result.data;
}

/** FTS5 query from free text: quoted terms OR'd, so bm25 ranks by overlap. */
export function toFtsQuery(query: string): string | null {
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9']+/g)
    ?.filter((t) => t.length > 2 && !STOP.has(t))
    .slice(0, 24);
  if (!terms?.length) return null;
  return [...new Set(terms)].map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
}

const STOP = new Set(
  "the and for that with this from are was were but not you your his her its our their they them what when who will would have has had into unto upon shall than then there these those which also been being".split(
    " ",
  ),
);

/** Embed + upsert a page of verses, keyed by D1 rowid cursor. */
export async function embedVersePage(
  env: { AI: Ai; BIBLE: D1Database; SCRIPTURE_VECTORS: VectorizeIndex },
  afterRowid: number,
  limit: number,
): Promise<{ processed: number; nextCursor: number | null }> {
  const { results } = await env.BIBLE.prepare(
    `SELECT rowid, book_id, chapter, verse, text FROM bible_verses WHERE rowid > ? ORDER BY rowid LIMIT ?`,
  )
    .bind(afterRowid, limit)
    .all<VerseRow & { rowid: number }>();
  const rows = results ?? [];
  if (!rows.length) return { processed: 0, nextCursor: null };

  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const vectors = await embedTexts(env.AI, slice.map(verseEmbeddingInput));
    await env.SCRIPTURE_VECTORS.upsert(
      slice.map((row, j) => ({
        id: verseId(row.book_id, row.chapter, row.verse),
        values: vectors[j]!,
        metadata: { book: row.book_id, chapter: row.chapter, verse: row.verse },
      })),
    );
  }
  return { processed: rows.length, nextCursor: rows.length < limit ? null : rows[rows.length - 1]!.rowid };
}

import { BIBLE_BOOKS } from "../bible/books";

export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

export type ScriptureHit = {
  reference: string;
  slug: string;
  chapter: number;
  verse: number;
  text: string;
  score: number;
  sources: ("semantic" | "text" | "verse")[];
};

export type SearchMode = "hybrid" | "semantic" | "text";

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

async function textSearch(db: D1Database, query: string, k: number): Promise<VerseRow[]> {
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

async function semanticSearch(ai: Ai, index: VectorizeIndex, query: string, k: number): Promise<string[]> {
  const [vector] = await embedTexts(ai, [query.slice(0, 2000)]);
  if (!vector) return [];
  const { matches } = await index.query(vector, { topK: k });
  return matches.map((m) => m.id);
}

async function loadVerses(db: D1Database, ids: string[]): Promise<Map<string, VerseRow>> {
  const map = new Map<string, VerseRow>();
  if (!ids.length) return map;
  const tuples = ids.map((id) => id.split(":").map(Number) as [number, number, number]);
  const where = tuples.map(() => "(book_id = ? AND chapter = ? AND verse = ?)").join(" OR ");
  const { results } = await db
    .prepare(`SELECT book_id, chapter, verse, text FROM bible_verses WHERE ${where}`)
    .bind(...tuples.flat())
    .all<VerseRow>();
  for (const row of results ?? []) map.set(verseId(row.book_id, row.chapter, row.verse), row);
  return map;
}

/** Hybrid search merged with Reciprocal Rank Fusion. */
export async function searchScripture(
  env: { AI?: Ai; BIBLE?: D1Database; SCRIPTURE_VECTORS?: VectorizeIndex },
  query: string,
  { mode = "hybrid", k = 12 }: { mode?: SearchMode; k?: number } = {},
): Promise<ScriptureHit[]> {
  if (!env.BIBLE) throw new Error("BIBLE D1 binding unavailable");
  const pool = Math.max(k * 2, 20);
  const canSemantic = !!env.AI && !!env.SCRIPTURE_VECTORS;

  const [semIds, textRows] = await Promise.all([
    mode !== "text" && canSemantic
      ? semanticSearch(env.AI!, env.SCRIPTURE_VECTORS!, query, pool).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
    mode !== "semantic" ? textSearch(env.BIBLE, query, pool).catch(() => [] as VerseRow[]) : Promise.resolve([]),
  ]);

  const RRF_K = 60;
  const fused = new Map<string, { score: number; sources: Set<"semantic" | "text"> }>();
  const add = (id: string, rank: number, source: "semantic" | "text") => {
    const entry = fused.get(id) ?? { score: 0, sources: new Set() };
    entry.score += 1 / (RRF_K + rank + 1);
    entry.sources.add(source);
    fused.set(id, entry);
  };
  semIds.forEach((id, rank) => add(id, rank, "semantic"));
  textRows.forEach((row, rank) => add(verseId(row.book_id, row.chapter, row.verse), rank, "text"));

  const top = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, k);
  const rows = new Map(textRows.map((row) => [verseId(row.book_id, row.chapter, row.verse), row]));
  const missing = top.map(([id]) => id).filter((id) => !rows.has(id));
  for (const [id, row] of await loadVerses(env.BIBLE, missing)) rows.set(id, row);

  return top.flatMap(([id, { score, sources }]) => {
    const row = rows.get(id);
    const book = row && bookById.get(row.book_id);
    if (!row || !book) return [];
    return [
      {
        reference: `${book.name} ${row.chapter}:${row.verse}`,
        slug: book.slug,
        chapter: row.chapter,
        verse: row.verse,
        text: cleanVerseText(row.text),
        score,
        sources: [...sources],
      },
    ];
  });
}

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

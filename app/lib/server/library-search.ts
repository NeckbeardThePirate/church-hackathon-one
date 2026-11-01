import { BIBLE_BOOKS } from "../bible/books";
import type { ParsedBibleReference } from "../bible/parse-reference";
import { embedTexts, toFtsQuery } from "./scripture-search";

export type HitSource = "semantic" | "text" | "verse";

export type FatherHit = {
  id: string;
  author: string;
  year: number | null;
  category: string | null;
  work: string | null;
  sourceUrl: string | null;
  /** Passage the comment is attached to, e.g. "Romans 3:28". */
  passage: string;
  text: string;
  /** Author was condemned by an ecumenical council (e.g. Pelagius, Arius). */
  condemned: boolean;
  score: number;
  sources: HitSource[];
};

export type ConfessionHit = {
  id: string;
  document: string;
  year: string | null;
  label: string | null;
  title: string | null;
  text: string;
  score: number;
  sources: HitSource[];
};

export type LibraryEnv = { AI?: Ai; BIBLE?: D1Database; LIBRARY_VECTORS?: VectorizeIndex };

type FatherRow = {
  rowid?: number;
  id: string;
  author: string;
  year: number | null;
  category: string | null;
  work: string | null;
  source_url: string | null;
  book_id: number;
  loc_start: number;
  loc_end: number;
  text: string;
  condemned?: number;
};

type ConfessionRow = {
  rowid?: number;
  id: string;
  doc_title: string;
  year: string | null;
  label: string | null;
  title: string | null;
  text: string;
};

const bookById = new Map(BIBLE_BOOKS.map((book) => [book.id, book]));
const LOC = 1_000_000;

function locLabel(bookId: number, start: number, end: number): string {
  const name = bookById.get(bookId)?.name ?? "";
  const [c1, v1, c2, v2] = [Math.floor(start / LOC), start % LOC, Math.floor(end / LOC), end % LOC];
  if (!v1) return `${name} ${c1}`;
  if (c1 === c2 && v1 === v2) return `${name} ${c1}:${v1}`;
  if (c1 === c2) return `${name} ${c1}:${v1}–${v2}`;
  return `${name} ${c1}:${v1}–${c2}:${v2}`;
}

function refRange(ref: ParsedBibleReference): [number, number, number] {
  return [ref.book.id, ref.chapter * LOC + ref.verseStart, ref.chapter * LOC + ref.verseEnd];
}

/** Reciprocal Rank Fusion over several ranked id lists. */
function fuse(lists: { ids: string[]; source: HitSource; weight?: number }[]) {
  const fused = new Map<string, { score: number; sources: Set<HitSource> }>();
  for (const { ids, source, weight = 1 } of lists) {
    ids.forEach((id, rank) => {
      const entry = fused.get(id) ?? { score: 0, sources: new Set<HitSource>() };
      entry.score += weight / (60 + rank + 1);
      entry.sources.add(source);
      fused.set(id, entry);
    });
  }
  return [...fused.entries()].sort((a, b) => b[1].score - a[1].score);
}

async function semanticIds(env: LibraryEnv, query: string, kind: "f" | "c", k: number): Promise<string[]> {
  if (!env.AI || !env.LIBRARY_VECTORS) return [];
  const [vector] = await embedTexts(env.AI, [query.slice(0, 2000)]);
  if (!vector) return [];
  const { matches } = await env.LIBRARY_VECTORS.query(vector, { topK: k, filter: { kind } });
  return matches.map((m) => m.id.slice(2)); // strip "f:" / "c:"
}

async function byIds<T extends { id: string }>(db: D1Database, table: string, ids: string[]): Promise<Map<string, T>> {
  const map = new Map<string, T>();
  if (!ids.length) return map;
  const { results } = await db
    .prepare(`SELECT * FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<T>();
  for (const row of results ?? []) map.set(row.id, row);
  return map;
}

function toFatherHit(row: FatherRow, score: number, sources: Set<HitSource>): FatherHit {
  return {
    id: row.id,
    author: row.author,
    year: row.year,
    category: row.category,
    work: row.work,
    sourceUrl: row.source_url,
    passage: locLabel(row.book_id, row.loc_start, row.loc_end),
    text: row.text,
    condemned: row.condemned === 1,
    score,
    sources: [...sources],
  };
}

export async function searchFathers(
  env: LibraryEnv,
  query: string,
  { k = 10, refs = [], mode = "hybrid" }: { k?: number; refs?: ParsedBibleReference[]; mode?: "hybrid" | "semantic" | "text" } = {},
): Promise<FatherHit[]> {
  const db = env.BIBLE;
  if (!db) throw new Error("BIBLE D1 binding unavailable");
  const pool = Math.max(k * 2, 20);
  const fts = mode !== "semantic" ? toFtsQuery(query) : null;

  const [sem, text, verse] = await Promise.all([
    mode !== "text" ? semanticIds(env, query, "f", pool).catch(() => []) : [],
    fts
      ? db
          .prepare(
            `SELECT q.id FROM father_quotes_fts f JOIN father_quotes q ON q.rowid = f.rowid
             WHERE father_quotes_fts MATCH ? ORDER BY bm25(father_quotes_fts) LIMIT ?`,
          )
          .bind(fts, pool)
          .all<{ id: string }>()
          .then((r) => (r.results ?? []).map((row) => row.id))
          .catch(() => [] as string[])
      : [],
    Promise.all(
      refs.slice(0, 6).map(async (ref) => {
        const [book, start, end] = refRange(ref);
        const { results } = await db
          .prepare(
            `SELECT id FROM father_quotes WHERE book_id = ? AND loc_start <= ? AND loc_end >= ?
             ORDER BY (loc_end - loc_start) ASC, year ASC LIMIT 8`,
          )
          .bind(book, end, start)
          .all<{ id: string }>();
        return (results ?? []).map((row) => row.id);
      }),
    ).then((lists) => lists.flat()),
  ]);

  const top = fuse([
    { ids: verse, source: "verse", weight: 1.5 },
    { ids: sem, source: "semantic" },
    { ids: text, source: "text" },
  ]).slice(0, k);
  const rows = await byIds<FatherRow>(db, "father_quotes", top.map(([id]) => id));
  return top.flatMap(([id, { score, sources }]) => {
    const row = rows.get(id);
    return row ? [toFatherHit(row, score, sources)] : [];
  });
}

export async function searchConfessions(
  env: LibraryEnv,
  query: string,
  { k = 10, refs = [], mode = "hybrid" }: { k?: number; refs?: ParsedBibleReference[]; mode?: "hybrid" | "semantic" | "text" } = {},
): Promise<ConfessionHit[]> {
  const db = env.BIBLE;
  if (!db) throw new Error("BIBLE D1 binding unavailable");
  const pool = Math.max(k * 2, 20);
  const fts = mode !== "semantic" ? toFtsQuery(query) : null;

  const [sem, text, verse] = await Promise.all([
    mode !== "text" ? semanticIds(env, query, "c", pool).catch(() => []) : [],
    fts
      ? db
          .prepare(
            `SELECT s.id FROM confession_sections_fts f JOIN confession_sections s ON s.rowid = f.rowid
             WHERE confession_sections_fts MATCH ? ORDER BY bm25(confession_sections_fts) LIMIT ?`,
          )
          .bind(fts, pool)
          .all<{ id: string }>()
          .then((r) => (r.results ?? []).map((row) => row.id))
          .catch(() => [] as string[])
      : [],
    Promise.all(
      refs.slice(0, 6).map(async (ref) => {
        const [book, start, end] = refRange(ref);
        const { results } = await db
          .prepare(
            `SELECT DISTINCT section_id AS id FROM confession_proofs
             WHERE book_id = ? AND loc_start <= ? AND loc_end >= ? LIMIT 8`,
          )
          .bind(book, end, start)
          .all<{ id: string }>();
        return (results ?? []).map((row) => row.id);
      }),
    ).then((lists) => lists.flat()),
  ]);

  const top = fuse([
    { ids: verse, source: "verse", weight: 1.5 },
    { ids: sem, source: "semantic" },
    { ids: text, source: "text" },
  ]).slice(0, k);
  const rows = await byIds<ConfessionRow & { doc_slug: string }>(db, "confession_sections", top.map(([id]) => id));
  return top.flatMap(([id, { score, sources }]) => {
    const row = rows.get(id);
    if (!row) return [];
    return [
      {
        id: row.id,
        document: row.doc_title,
        year: row.year,
        label: row.label,
        title: row.title,
        text: row.text,
        score,
        sources: [...sources],
      },
    ];
  });
}

/** Embed + upsert one page of fathers or confessions into LIBRARY_VECTORS. */
export async function embedLibraryPage(
  env: { AI: Ai; BIBLE: D1Database; LIBRARY_VECTORS: VectorizeIndex },
  corpus: "fathers" | "confessions",
  afterRowid: number,
  limit: number,
): Promise<{ processed: number; nextCursor: number | null }> {
  type Item = { rowid: number; id: string; input: string; year: number };
  let items: Item[];
  if (corpus === "fathers") {
    const { results } = await env.BIBLE.prepare(
      `SELECT rowid, id, author, year, work, book_id, loc_start, loc_end, substr(text, 1, 1500) AS text
       FROM father_quotes WHERE rowid > ? ORDER BY rowid LIMIT ?`,
    )
      .bind(afterRowid, limit)
      .all<FatherRow & { rowid: number }>();
    items = (results ?? []).map((row) => ({
      rowid: row.rowid,
      id: `f:${row.id}`,
      year: row.year ?? 0,
      input: `${row.author}${row.work ? `, ${row.work}` : ""} on ${locLabel(row.book_id, row.loc_start, row.loc_end)}: ${row.text}`,
    }));
  } else {
    const { results } = await env.BIBLE.prepare(
      `SELECT rowid, id, doc_title, year, label, title, substr(text, 1, 1500) AS text
       FROM confession_sections WHERE rowid > ? ORDER BY rowid LIMIT ?`,
    )
      .bind(afterRowid, limit)
      .all<ConfessionRow & { rowid: number }>();
    items = (results ?? []).map((row) => ({
      rowid: row.rowid,
      id: `c:${row.id}`.slice(0, 64),
      year: Number.parseInt(row.year ?? "", 10) || 0,
      input: `${row.doc_title}${row.label ? ` ${row.label}` : ""}${row.title ? ` — ${row.title}` : ""}: ${row.text}`,
    }));
  }
  if (!items.length) return { processed: 0, nextCursor: null };

  const BATCH = 100;
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const vectors = await embedTexts(env.AI, slice.map((item) => item.input));
    await env.LIBRARY_VECTORS.upsert(
      slice.map((item, j) => ({
        id: item.id,
        values: vectors[j]!,
        metadata: { kind: corpus === "fathers" ? "f" : "c", year: item.year },
      })),
    );
  }
  return { processed: items.length, nextCursor: items.length < limit ? null : items[items.length - 1]!.rowid };
}

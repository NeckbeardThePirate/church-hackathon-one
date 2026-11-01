import { BIBLE_BOOKS } from "@/app/lib/bible/books";

const ROMANS_URL =
  "https://raw.githubusercontent.com/wldeh/bible-api/main/bibles/en-bsb/books/romans/chapters/3.json";

const WCF_11 =
  "Those whom God effectually calleth, He also freely justifieth; not by infusing righteousness into them, but by pardoning their sins, and by accounting and accepting their persons as righteous; not for any thing wrought in them, or done by them, but for Christ's sake alone; not by imputing faith itself, the act of believing, or any other evangelical obedience to them, as their righteousness; but by imputing the obedience and satisfaction of Christ unto them, they receiving and resting on Him and His righteousness by faith; which faith they have not of themselves, it is the gift of God.";

const CHRYSOSTOM =
  "For you do not achieve it by toilings and labors, but you receive it as a gift from above, contributing one thing only from your own store, believing.";

async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS bible_books (
        id INTEGER PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS bible_verses (
        book_id INTEGER NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (book_id, chapter, verse)
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS father_quotes (
        id TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        year INTEGER,
        category TEXT,
        work TEXT,
        source_url TEXT,
        book_id INTEGER NOT NULL,
        loc_start INTEGER NOT NULL,
        loc_end INTEGER NOT NULL,
        text TEXT NOT NULL,
        condemned INTEGER NOT NULL DEFAULT 0
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS confession_sections (
        id TEXT PRIMARY KEY,
        doc_slug TEXT NOT NULL,
        doc_title TEXT NOT NULL,
        year TEXT,
        format TEXT,
        label TEXT,
        title TEXT,
        text TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS confession_proofs (
        section_id TEXT NOT NULL,
        book_id INTEGER NOT NULL,
        loc_start INTEGER NOT NULL,
        loc_end INTEGER NOT NULL
      )`,
    ),
  ]);
}

/** Idempotent local sample: Romans 3 (BSB, fetched, not committed) plus public-domain WCF and Chrysostom. */
export async function seedLocalCitations(db: D1Database): Promise<{ verses: number }> {
  await ensureSchema(db);
  for (const book of BIBLE_BOOKS) {
    await db
      .prepare(
        `INSERT INTO bible_books (id, slug, name, sort_order) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(book.id, book.slug, book.name, book.id)
      .run();
  }

  let verses = 0;
  const response = await fetch(ROMANS_URL, { signal: AbortSignal.timeout(15000) });
  if (response.ok) {
    const payload = (await response.json()) as { data?: { verse: string; text: string }[] };
    for (const row of payload.data ?? []) {
      const verse = Number(row.verse);
      if (!Number.isFinite(verse) || !row.text) continue;
      await db
        .prepare(
          `INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (45, 3, ?, ?)
           ON CONFLICT(book_id, chapter, verse) DO NOTHING`,
        )
        .bind(verse, row.text)
        .run();
      verses += 1;
    }
  }

  await db
    .prepare(
      `INSERT INTO confession_sections (id, doc_slug, doc_title, year, format, label, title, text)
       VALUES ('dev-wcf-11', 'wcf', 'Westminster Confession of Faith', '1646', 'chapter', '11.1', 'Of Justification', ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(WCF_11)
    .run();
  await db
    .prepare(
      `INSERT INTO confession_proofs (section_id, book_id, loc_start, loc_end)
       SELECT 'dev-wcf-11', 45, 3000021, 3000026
       WHERE NOT EXISTS (
         SELECT 1 FROM confession_proofs WHERE section_id = 'dev-wcf-11' AND book_id = 45
       )`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO father_quotes (
         id, author, year, category, work, source_url, book_id, loc_start, loc_end, text, condemned
       ) VALUES (
         'dev-chrysostom-rom3', 'John Chrysostom', 407, 'greek', 'Homilies on Romans',
         'https://ccel.org/ccel/schaff/npnf111', 45, 3000021, 3000026, ?, 0
       )
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(CHRYSOSTOM)
    .run();

  return { verses };
}

-- Church fathers (HistoricalChristianFaith/Commentaries-Database) and
-- confessions/catechisms (NonlinearFruit/Creeds.json, public-domain items only).
-- Locations encode chapter*1000000 + verse, matching the source DB.

CREATE TABLE IF NOT EXISTS father_quotes (
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
);
CREATE INDEX IF NOT EXISTS idx_father_loc ON father_quotes(book_id, loc_start, loc_end);

CREATE TABLE IF NOT EXISTS confession_sections (
  id TEXT PRIMARY KEY,
  doc_slug TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  year TEXT,
  format TEXT,
  label TEXT,
  title TEXT,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS confession_proofs (
  section_id TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  loc_start INTEGER NOT NULL,
  loc_end INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_confession_proofs_loc ON confession_proofs(book_id, loc_start, loc_end);

CREATE VIRTUAL TABLE IF NOT EXISTS father_quotes_fts USING fts5(
  text, author, work, content='father_quotes', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE VIRTUAL TABLE IF NOT EXISTS confession_sections_fts USING fts5(
  text, title, doc_title, content='confession_sections', content_rowid='rowid', tokenize='porter unicode61'
);

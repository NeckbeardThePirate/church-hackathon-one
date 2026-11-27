-- Verse-anchored public-domain commentaries.
-- First load: Matthew Henry on John and Matthew 6
-- (Christian Classics Ethereal Library, public domain).
-- Locations encode chapter*1000000 + verse, matching father_quotes.

CREATE TABLE IF NOT EXISTS commentary_entries (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  year INTEGER,
  work TEXT NOT NULL,
  section_label TEXT,
  source_url TEXT,
  attribution TEXT,
  book_id INTEGER NOT NULL,
  loc_start INTEGER NOT NULL,
  loc_end INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commentary_loc ON commentary_entries(book_id, loc_start, loc_end);

CREATE VIRTUAL TABLE IF NOT EXISTS commentary_entries_fts USING fts5(
  text, author, work, section_label,
  content='commentary_entries', content_rowid='rowid', tokenize='porter unicode61'
);

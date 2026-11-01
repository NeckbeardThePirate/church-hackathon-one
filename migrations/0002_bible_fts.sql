-- Full-text index over BSB verses (external content → bible_verses).
CREATE VIRTUAL TABLE IF NOT EXISTS bible_verses_fts USING fts5(
  text,
  content='bible_verses',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- (Re)build from current rows. Re-run after reseeding: npm run bible:fts
INSERT INTO bible_verses_fts(bible_verses_fts) VALUES('rebuild');

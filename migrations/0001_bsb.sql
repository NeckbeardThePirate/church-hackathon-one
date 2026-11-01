CREATE TABLE IF NOT EXISTS bible_books (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bible_verses (
  book_id INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (book_id, chapter, verse),
  FOREIGN KEY (book_id) REFERENCES bible_books(id)
);

CREATE INDEX IF NOT EXISTS idx_bible_verses_range ON bible_verses(book_id, chapter, verse);

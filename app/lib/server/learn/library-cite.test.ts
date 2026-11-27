import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { rankForPerspective, resolveLibraryRefs, splitLibraryReference } from "./library-cite.ts";
import { librarySourceLabel } from "../../learn/types.ts";

const STORED =
  "Those whom God effectually calleth, He also freely justifieth; not by infusing righteousness into them, but by pardoning their sins.";

test("Reformed plans sort Westminster and the Three Forms ahead of other standards", () => {
  const hits = [
    { document: "Catechism of the Catholic Church", label: "1987" },
    { document: "Westminster Confession of Faith", label: "11.1" },
    { document: "Heidelberg Catechism", label: "Q. 60" },
  ];
  const ranked = rankForPerspective(hits, "Reformed").map((hit) => hit.document);
  assert.equal(ranked[2], "Catechism of the Catholic Church");
  assert.ok(ranked.indexOf("Westminster Confession of Faith") < ranked.indexOf("Catechism of the Catholic Church"));
});

test("other perspectives keep retrieval order", () => {
  const hits = [{ document: "A" }, { document: "Westminster Confession of Faith" }];
  assert.deepEqual(
    rankForPerspective(hits, "neutral").map((hit) => hit.document),
    ["A", "Westminster Confession of Faith"],
  );
});

test("a library reference splits a section label from the document name", () => {
  assert.deepEqual(splitLibraryReference("Westminster Confession of Faith 11.1"), {
    head: "Westminster Confession of Faith",
    detail: "11.1",
  });
  assert.deepEqual(splitLibraryReference("Westminster Shorter Catechism 100"), {
    head: "Westminster Shorter Catechism",
    detail: "100",
  });
  assert.deepEqual(splitLibraryReference("Westminster Larger Catechism, 186"), {
    head: "Westminster Larger Catechism",
    detail: "186",
  });
  assert.deepEqual(splitLibraryReference("John Chrysostom, Homilies on Romans"), {
    head: "John Chrysostom",
    detail: "Homilies on Romans",
  });
});

test("resolved library wording comes from the stored row and a miss is dropped", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE confession_sections (
      id TEXT PRIMARY KEY,
      doc_title TEXT NOT NULL,
      label TEXT,
      title TEXT,
      text TEXT NOT NULL
    );
    CREATE TABLE father_quotes (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      work TEXT,
      source_url TEXT,
      text TEXT NOT NULL,
      condemned INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare(
    "INSERT INTO confession_sections (id, doc_title, label, title, text) VALUES (?, ?, ?, ?, ?)",
  ).run("dev-wcf-11", "Westminster Confession of Faith", "11.1", "Of Justification", STORED);
  db.prepare(
    "INSERT INTO father_quotes (id, author, work, source_url, text, condemned) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("dev-chrysostom", "John Chrysostom", "Homilies on Romans", "https://example.test/chrysostom", "Retrieved father wording.", 0);

  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((part) => String(part)).join(" "));
  };
  try {
    const resolved = await resolveLibraryRefs(asD1(db), [
      { reference: "Westminster Confession of Faith 11.1", note: "Why it connects." },
      { reference: "Westminster Confession of Faith 11.1", note: "duplicate" },
      { reference: "John Chrysostom, Homilies on Romans", note: "Retrieved father wording." },
      { reference: "Invented Confession 9.9", note: "The model must not supply this wording." },
    ]);
    assert.equal(resolved.citations.length, 2);
    assert.equal(resolved.citations[0]?.text, STORED);
    assert.equal(resolved.citations[0]?.note, "Why it connects.");
    assert.equal(resolved.citations[1]?.source, "father");
    assert.equal(resolved.citations[1]?.text, "Retrieved father wording.");
    assert.equal(resolved.citations[1]?.note, "");
    assert.equal(JSON.stringify(resolved).includes("Quoted from"), false);
    assert.equal(JSON.stringify(resolved).includes("From the retrieved commentary"), false);
    assert.equal(JSON.stringify(resolved).includes("Comment on"), false);
    assert.deepEqual(resolved.dropped, ["Invented Confession 9.9"]);
    assert.match(warnings.join("\n"), /Invented Confession 9\.9/);
    assert.equal(JSON.stringify(resolved).includes("The model must not supply"), false);
    const missing = await resolveLibraryRefs({} as never, [{ reference: "Westminster Confession of Faith 11.1", note: "" }]);
    assert.deepEqual(missing.citations, []);
    assert.deepEqual(missing.dropped, ["Westminster Confession of Faith 11.1"]);
  } finally {
    console.warn = original;
  }
});

test("catechism numbers, Lord's Day 45, and Matthew Henry resolve from stored rows", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE confession_sections (
      id TEXT PRIMARY KEY,
      doc_slug TEXT NOT NULL,
      doc_title TEXT NOT NULL,
      label TEXT,
      title TEXT,
      text TEXT NOT NULL
    );
    CREATE TABLE father_quotes (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      work TEXT,
      source_url TEXT,
      text TEXT NOT NULL,
      condemned INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE commentary_entries (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      work TEXT NOT NULL,
      section_label TEXT,
      source_url TEXT,
      text TEXT NOT NULL,
      book_id INTEGER NOT NULL,
      loc_start INTEGER NOT NULL,
      loc_end INTEGER NOT NULL
    );
  `);
  db.prepare(
    "INSERT INTO confession_sections (id, doc_slug, doc_title, label, title, text) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("westminster_larger_catechism:Q186", "westminster_larger_catechism", "Westminster Larger Catechism", "Q186", "The rule for prayer", "The whole Word of God is of use.");
  db.prepare(
    "INSERT INTO confession_sections (id, doc_slug, doc_title, label, title, text) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("heidelberg_catechism:Q116", "heidelberg_catechism", "Heidelberg Catechism", "Q116", "Prayer", "Q. Why is prayer necessary? A. Because it is thankfulness.");
  db.prepare(
    "INSERT INTO confession_sections (id, doc_slug, doc_title, label, title, text) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("heidelberg_catechism:Q119", "heidelberg_catechism", "Heidelberg Catechism", "Q119", "The Lord's prayer", "Q. What is the Lord's prayer? A. Our Father.");
  db.prepare(
    `INSERT INTO commentary_entries (id, author, work, section_label, source_url, text, book_id, loc_start, loc_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "mhc-jn-1-1-5",
    "Matthew Henry",
    "Commentary on the Whole Bible",
    "John 1:1–5",
    "https://ccel.org/ccel/henry/mhc5.John.ii.html",
    "In the beginning was the Word, and Henry explains that the Word was God.",
    43,
    1000001,
    1000005,
  );

  const resolved = await resolveLibraryRefs(asD1(db), [
    { reference: "Westminster Larger Catechism, 186", note: "The rule Christ gave." },
    { reference: "Heidelberg Catechism Lord's Day 45", note: "Prayer is thankfulness." },
    { reference: "Matthew Henry, John 1:1", note: "The Word was with God." },
  ]);
  assert.equal(resolved.dropped.length, 0);
  assert.equal(resolved.citations[0]?.text, "The whole Word of God is of use.");
  assert.equal(resolved.citations[0]?.label, "Westminster Larger Catechism Q186");
  assert.match(resolved.citations[1]?.label ?? "", /Lord's Day 45/);
  assert.match(resolved.citations[1]?.text ?? "", /Why is prayer necessary/);
  assert.match(resolved.citations[1]?.text ?? "", /Our Father/);
  assert.equal(resolved.citations[2]?.source, "commentary");
  assert.equal(resolved.citations[2]?.label, "Matthew Henry");
  assert.match(resolved.citations[2]?.detail ?? "", /public domain, CCEL/);
  assert.match(resolved.citations[2]?.text ?? "", /the Word was God/);
  assert.equal(librarySourceLabel("commentary"), "Commentary");
  assert.equal(librarySourceLabel("confession"), "Confession");
  assert.equal(librarySourceLabel("father"), "Church father");
});

function asD1(db: DatabaseSync) {
  return {
    BIBLE: {
      prepare(query: string) {
        const statement = db.prepare(query);
        return {
          bind(...args: unknown[]) {
            return {
              all: async () => ({
                results: statement.all(...(args as (string | number | null | bigint)[])),
              }),
            };
          },
        };
      },
    },
  } as never;
}

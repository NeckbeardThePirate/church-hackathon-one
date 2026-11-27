import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { rankForPerspective, resolveLibraryRefs, splitLibraryReference } from "./library-cite.ts";

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

import assert from "node:assert/strict";
import test from "node:test";
import { WHOLE_CHAPTER_END, findBibleReferences, parsePassage, parsePassageList } from "./parse-reference.ts";

test("parsePassage reads a verse range with an abbreviated book", () => {
  assert.deepEqual(parsePassage("rom 8:1-17"), {
    slug: "romans",
    chapter: 8,
    verseStart: 1,
    verseEnd: 17,
    label: "Romans 8:1–17",
  });
});

test("parsePassage reads a single verse, numbered books and a whole chapter", () => {
  assert.equal(parsePassage("John 3:16")?.label, "John 3:16");
  assert.equal(parsePassage("1 Cor 13:4–7")?.slug, "1corinthians");
  const chapter = parsePassage("Psalm 23");
  assert.equal(chapter?.label, "Psalms 23");
  assert.equal(chapter?.verseStart, 1);
  assert.equal(chapter?.verseEnd, WHOLE_CHAPTER_END);
});

test("parsePassage rejects text that is not exactly one real reference", () => {
  for (const bad of ["", "hello", "Romans", "Romans 99", "Romans 8:17-1", "Romans 8:1 and more", "Narnia 3:1", "Romans 8:1; John 3:16"]) {
    assert.equal(parsePassage(bad), null, bad);
  }
});

test("parsePassageList splits on semicolons and newlines, drops duplicates, reports invalid parts", () => {
  const { passages, invalid } = parsePassageList("Romans 8:1-17; John 3:16\nrom 8:1–17\nnonsense");
  assert.deepEqual(
    passages.map((p) => p.label),
    ["Romans 8:1–17", "John 3:16"],
  );
  assert.deepEqual(invalid, ["nonsense"]);
});

test("findBibleReferences still finds references inside prose", () => {
  assert.equal(findBibleReferences("See Romans 3:21-26 for this.")[0]?.label, "Romans 3:21–26");
});

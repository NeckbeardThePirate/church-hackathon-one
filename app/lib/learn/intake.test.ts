import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_NOTES,
  MAX_PHOTOS,
  deriveTopic,
  hasIntake,
  learnerContext,
  mergeNotes,
  parseIntakeBody,
  passagesForLesson,
} from "./intake.ts";
import { parsePassage, type PassageRef } from "../bible/parse-reference.ts";

const ref = (s: string) => parsePassage(s) as PassageRef;

test("combined body merges photo text after notes and keeps passages and topic", () => {
  const result = parseIntakeBody({
    topic: "Justification",
    notes: "My notes",
    passages: ["Romans 3:21-26", "Galatians 2:16"],
    photos: [
      { name: "page1.jpg", text: "  Faith alone  " },
      { name: "blank.jpg", text: "   " },
      { name: "page2.jpg", text: "Works of the law" },
    ],
  });
  assert.ok(result.ok);
  assert.equal(result.topic, "Justification");
  assert.deepEqual(
    result.passages.map((p) => p.label),
    ["Romans 3:21–26", "Galatians 2:16"],
  );
  assert.equal(
    result.notes,
    "My notes\n\n---\n\n[Photo: page1.jpg]\nFaith alone\n\n---\n\n[Photo: page2.jpg]\nWorks of the law",
  );
  assert.deepEqual(result.sources, { photos: 2, passages: 2, notes: true });
});

test("any single source is enough", () => {
  assert.ok(parseIntakeBody({ topic: "Compound interest" }).ok);
  assert.ok(parseIntakeBody({ notes: "Chapter 4 review\nmore" }).ok);
  assert.ok(parseIntakeBody({ passages: ["Psalm 23"] }).ok);
  assert.ok(parseIntakeBody({ photos: [{ name: "a.png", text: "Syllabus week 1" }] }).ok);
});

test("blank topic is derived: passages first, then notes, then photo text", () => {
  const p = parseIntakeBody({ passages: ["Psalm 23", "John 1:1-5"], notes: "ignored" });
  assert.ok(p.ok);
  assert.equal(p.topic, "Study of Psalms 23; John 1:1–5");
  const n = parseIntakeBody({ notes: "\nWeek one: limits\nmore" });
  assert.ok(n.ok);
  assert.equal(n.topic, "Week one: limits");
  const ph = parseIntakeBody({ photos: [{ name: "a.png", text: "Syllabus week 1" }] });
  assert.ok(ph.ok);
  assert.equal(ph.topic, "Syllabus week 1");
});

test("nothing usable is rejected", () => {
  for (const body of [{}, { topic: "  " }, { topic: "ab" }, { photos: [{ name: "a", text: " " }] }, { passages: [] }]) {
    assert.equal(parseIntakeBody(body).ok, false, JSON.stringify(body));
  }
});

test("bad passages, oversize notes, and too many photos are rejected", () => {
  assert.equal(parseIntakeBody({ topic: "Grace", passages: ["Narnia 1:1"] }).ok, false);
  assert.equal(parseIntakeBody({ topic: "Grace", passages: "Romans 8" }).ok, false);
  assert.equal(parseIntakeBody({ topic: "Grace", notes: "x".repeat(MAX_NOTES + 1) }).ok, false);
  const photos = Array.from({ length: MAX_PHOTOS + 1 }, () => ({ name: "a", text: "t" }));
  assert.equal(parseIntakeBody({ topic: "Grace", photos }).ok, false);
});

test("legacy {topic, notes} bodies behave as before", () => {
  const result = parseIntakeBody({ topic: "Romans", notes: "n" });
  assert.ok(result.ok);
  assert.equal(result.topic, "Romans");
  assert.equal(result.notes, "n");
  assert.deepEqual(result.passages, []);
});

test("helpers: hasIntake, deriveTopic and mergeNotes", () => {
  const empty = { topic: "", notes: "", passages: [], photos: [] };
  assert.equal(hasIntake(empty), false);
  assert.equal(hasIntake({ ...empty, passages: [ref("John 3:16")] }), true);
  assert.equal(deriveTopic({ ...empty, passages: ["a", "b", "c", "d"].map(() => ref("John 3:16")) }).startsWith("Study of"), true);
  assert.equal(mergeNotes("", [{ name: "", text: "only photo" }]), "only photo");
});

test("learnerContext includes notes and passage text; legacy plans without passages still work", () => {
  const ctx = learnerContext("Some notes", [{ reference: "John 3:16", text: "For God so loved" }], { notes: 100, passageChars: 400 });
  assert.match(ctx, /Learner notes:/);
  assert.match(ctx, /- John 3:16: For God so loved/);
  assert.equal(learnerContext("", undefined, { notes: 100, passageChars: 400 }), "");
  assert.match(learnerContext("x".repeat(50), [], { notes: 10, passageChars: 100 }), /x{10}…/);
});

test("each learner passage lands in exactly one lesson", () => {
  const list = ["a", "b", "c", "d", "e"];
  const byLesson = [1, 2, 3].map((order) => passagesForLesson(list, order, 3));
  assert.deepEqual(byLesson, [["a", "d"], ["b", "e"], ["c"]]);
  assert.deepEqual(passagesForLesson(list, 1, 1), list);
  assert.deepEqual(passagesForLesson(list, 1, 0), []);
});

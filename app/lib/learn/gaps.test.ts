import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  insertGapLesson,
  lessonsForFinalMix,
  MAX_GAP_LESSONS_PER_CORE,
  missedGapConcepts,
  parseGapRequest,
  selectGapConcepts,
  type GapLessonRef,
} from "./gaps.ts";

const core = (id: string): GapLessonRef => ({ id, kind: "core" });

test("a second miss of the same concept does not create another gap", () => {
  const lessons: GapLessonRef[] = [
    core("l1"),
    { id: "gap-l1-1", kind: "gap", sourceLessonId: "l1", sourceConceptIds: ["l1-faith"] },
  ];
  const again = selectGapConcepts(lessons, "l1", [{ conceptId: "l1-faith", conceptLabel: "Faith" }]);
  assert.equal(again.error, undefined);
  assert.deepEqual(again.concepts, []);
  assert.deepEqual(again.skipped, [{ conceptId: "l1-faith", reason: "covered" }]);
});

test("one core lesson can spawn at most three gap lessons, and a new concept on another lesson still can", () => {
  const lessons: GapLessonRef[] = [core("l1"), core("l2")];
  for (let n = 1; n <= MAX_GAP_LESSONS_PER_CORE; n++) {
    lessons.push({
      id: `gap-l1-${n}`,
      kind: "gap",
      sourceLessonId: "l1",
      sourceConceptIds: [`l1-idea-${n}`],
    });
  }
  const capped = selectGapConcepts(lessons, "l1", [{ conceptId: "l1-idea-4", conceptLabel: "A fourth idea" }]);
  assert.equal(capped.error, "This lesson already has three practice lessons.");
  assert.deepEqual(capped.concepts, []);
  assert.equal(capped.skipped[0]?.reason, "capped");

  const other = selectGapConcepts(lessons, "l2", [{ conceptId: "l2-hope", conceptLabel: "Hope" }]);
  assert.deepEqual(other.concepts, [{ conceptId: "l2-hope", conceptLabel: "Hope" }]);
  assert.equal(other.error, undefined);
});

test("concepts already covered are skipped and the rest of one request is kept", () => {
  const lessons: GapLessonRef[] = [
    core("l1"),
    { id: "gap-l1-1", kind: "gap", sourceLessonId: "l1", sourceConceptIds: ["l1-faith"] },
  ];
  const selected = selectGapConcepts(lessons, "l1", [
    { conceptId: "l1-faith", conceptLabel: "Faith" },
    { conceptId: "l1-hope", conceptLabel: "Hope" },
  ]);
  assert.deepEqual(selected.concepts, [{ conceptId: "l1-hope", conceptLabel: "Hope" }]);
  assert.deepEqual(selected.skipped, [{ conceptId: "l1-faith", reason: "covered" }]);
});

test("a gap lesson cannot be the source of another gap", () => {
  const selected = selectGapConcepts(
    [{ id: "gap-l1-1", kind: "gap", sourceLessonId: "l1", sourceConceptIds: ["l1-faith"] }],
    "gap-l1-1",
    [{ conceptId: "l1-faith", conceptLabel: "Faith" }],
  );
  assert.equal(selected.error, "Unknown lesson.");
});

test("a gap lesson is ordered after its parent and before the next core lesson", () => {
  const lessons: GapLessonRef[] = [
    { id: "l1", kind: "core" },
    { id: "l2", kind: "core" },
  ];
  const first = insertGapLesson(lessons, { id: "gap-l1-1", kind: "gap", sourceLessonId: "l1", sourceConceptIds: ["l1-faith"] });
  assert.deepEqual(first.map((lesson) => lesson.id), ["l1", "gap-l1-1", "l2"]);
  const second = insertGapLesson(first, { id: "gap-l1-2", kind: "gap", sourceLessonId: "l1", sourceConceptIds: ["l1-hope"] });
  assert.deepEqual(second.map((lesson) => lesson.id), ["l1", "gap-l1-1", "gap-l1-2", "l2"]);
});

test("final assessment mix excludes gap lessons", () => {
  const mixed = lessonsForFinalMix([
    { id: "l1", kind: "core", teaching: [{ text: "Core" }] },
    { id: "gap-l1-1", kind: "gap", teaching: [{ text: "Practice" }] },
    { id: "l2", teaching: [{ text: "Stored without kind" }] },
    { id: "empty", kind: "core", teaching: [] },
  ]);
  assert.deepEqual(mixed.map((lesson) => lesson.id), ["l1", "l2"]);
  const stages = readFileSync(new URL("../server/learn/stages.ts", import.meta.url), "utf8");
  assert.match(stages, /lessonsForFinalMix\(lessons\)/);
  assert.match(stages, /job === "gap"/);
});

test("missed concepts keep the first label and drop untagged or correct answers", () => {
  assert.deepEqual(
    missedGapConcepts([
      { correct: true, conceptId: "l1-kept", conceptLabel: "Kept" },
      { correct: false, conceptId: "l1-faith", conceptLabel: "Faith" },
      { correct: false, conceptId: "l1-faith", conceptLabel: "Faith again" },
      { correct: false, conceptLabel: "No id" },
      { correct: null, conceptId: "l1-open", conceptLabel: "Open" },
    ]),
    [{ conceptId: "l1-faith", conceptLabel: "Faith" }],
  );
});

test("gap requests reject a missing lesson id and accept one concept", () => {
  assert.equal(parseGapRequest({ concepts: [] }).ok, false);
  const parsed = parseGapRequest({
    sourceLessonId: "l1",
    concepts: [{ conceptId: "l1-faith", conceptLabel: "Faith" }],
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.request.concepts[0]?.conceptId, "l1-faith");
});

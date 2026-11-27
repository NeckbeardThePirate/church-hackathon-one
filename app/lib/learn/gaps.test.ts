import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attachFinalConcepts,
  gapTicketIsStale,
  GAP_REQUEUE_AFTER_MS,
  groupMissesBySource,
  insertGapLesson,
  lessonsForFinalMix,
  MAX_GAP_LESSONS_PER_CORE,
  missedGapConcepts,
  parseGapRequest,
  adoptLiveGapLessons,
  adoptLivePlan,
  practiceCardHeading,
  practiceCards,
  preserveGapLessons,
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

test("final misses map onto the core lesson that taught the concept", () => {
  const lessons = [
    {
      id: "l1",
      kind: "core",
      title: "Line by line",
      quiz: [{ conceptId: "l1-line", conceptLabel: "Line-by-line comparison" }],
    },
    {
      id: "l2",
      kind: "core",
      quiz: [{ conceptId: "l2-kindness", conceptLabel: "Kindness" }],
    },
    { id: "gap-l1-1", kind: "gap", sourceLessonId: "l1", sourceConceptIds: ["l1-old"] },
  ];
  const requests = groupMissesBySource(lessons, [
    { conceptId: "l1-line", conceptLabel: "Line-by-line comparison" },
    { conceptId: "final-kindness", conceptLabel: "Kindness" },
    { conceptId: "l1-line", conceptLabel: "Line-by-line comparison" },
  ]);
  assert.deepEqual(requests, [
    { sourceLessonId: "l1", concepts: [{ conceptId: "l1-line", conceptLabel: "Line-by-line comparison" }] },
    { sourceLessonId: "l2", concepts: [{ conceptId: "final-kindness", conceptLabel: "Kindness" }] },
  ]);
  const cards = practiceCards(lessons, requests);
  assert.equal(cards.some((card) => card.gapLessonId === "gap-l1-1"), true);
  assert.deepEqual(
    cards.filter((card) => !card.gapLessonId).map((card) => card.sourceLessonId),
    ["l1", "l2"],
  );
  const covered = practiceCards(
    [...lessons, { id: "gap-l1-2", kind: "gap", sourceLessonId: "l1", sourceConceptIds: ["l1-line"] }],
    requests,
  );
  assert.equal(covered.some((card) => !card.gapLessonId && card.concepts.some((concept) => concept.conceptId === "l1-line")), false);
});

test("a plan snapshot missing a gap lesson plus a live gap renders ready, not Generate", () => {
  const snapshot = [
    {
      id: "l1",
      kind: "core",
      title: "Line by line",
      quiz: [{ conceptId: "l1-line", conceptLabel: "Line-by-line comparison" }],
    },
    { id: "l2", kind: "core", title: "Next" },
  ];
  const liveGap = {
    id: "gap-l1-1",
    kind: "gap" as const,
    title: "Practice: Line-by-line comparison",
    status: "ok" as const,
    sourceLessonId: "l1",
    sourceConceptIds: ["l1-line"],
    teaching: [{ text: "Set the lines next to each other." }],
  };
  const lessons = adoptLiveGapLessons(snapshot, [...snapshot, liveGap]);
  assert.deepEqual(lessons.map((lesson) => lesson.id), ["l1", "gap-l1-1", "l2"]);
  const misses = [
    { sourceLessonId: "l1", concepts: [{ conceptId: "l1-line", conceptLabel: "Line-by-line comparison" }] },
  ];
  const cards = practiceCards(lessons, misses);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.gapLessonId, "gap-l1-1");
  assert.equal(practiceCardHeading(cards[0]!), "Practice lesson ready: Practice: Line-by-line comparison");
  assert.equal(cards.some((card) => practiceCardHeading(card) === "Generate gap lesson"), false);

  const pending = adoptLiveGapLessons(snapshot, [
    ...snapshot,
    { ...liveGap, id: "gap-l1-2", status: "pending", teaching: [] },
  ]);
  assert.deepEqual(pending.map((lesson) => lesson.id), ["l1", "l2"]);
});

test("a pending core lesson picks up the written page from the live plan", () => {
  const snapshot = {
    id: "plan-1",
    lessons: [
      { id: "l1", kind: "core", status: "pending", teaching: [], quiz: [] },
      { id: "l2", kind: "core", status: "ok", teaching: ["later"], quiz: ["q"] },
    ],
  };
  const adopted = adoptLivePlan(snapshot, {
    id: "plan-1",
    lessons: [
      { id: "l1", kind: "core", status: "ok", teaching: ["I am the bread of life."], quiz: ["check"] },
      { id: "l2", kind: "core", status: "pending", teaching: [], quiz: [] },
    ],
  });
  assert.equal(adopted.lessons[0]?.status, "ok");
  assert.equal(adopted.lessons[0]?.teaching?.[0], "I am the bread of life.");
  assert.equal(adopted.lessons[1]?.status, "ok");
  assert.equal(adopted.lessons[1]?.teaching?.[0], "later");
});

test("a newer plan save keeps a gap lesson it left out", () => {
  const stored = [
    { id: "l1", kind: "core" },
    { id: "gap-l1-1", kind: "gap", sourceLessonId: "l1", sourceConceptIds: ["l1-line"] },
    { id: "l2", kind: "core" },
  ];
  const incoming = [
    { id: "l1", kind: "core" },
    { id: "l2", kind: "core" },
  ];
  assert.deepEqual(preserveGapLessons(incoming, stored).map((lesson) => lesson.id), ["l1", "gap-l1-1", "l2"]);
});

test("a reserved practice job with no timestamp can be queued again", () => {
  assert.equal(gapTicketIsStale(undefined, 10_000), true);
  assert.equal(gapTicketIsStale(10_000, 10_000 + GAP_REQUEUE_AFTER_MS - 1), false);
  assert.equal(gapTicketIsStale(10_000, 10_000 + GAP_REQUEUE_AFTER_MS), true);
});

test("final items reuse a lesson concept id or label", () => {
  const lessons = [
    {
      id: "l1",
      quiz: [{ conceptId: "l1-line", conceptLabel: "Line-by-line comparison" }],
    },
  ];
  const tagged = attachFinalConcepts(
    [
      { question: "Compare", conceptId: "l1-line", conceptLabel: "Wrong label" },
      { question: "Again", conceptLabel: "Line-by-line comparison" },
      { question: "Untagged" },
    ],
    lessons,
  );
  assert.equal(tagged[0]?.conceptId, "l1-line");
  assert.equal(tagged[0]?.conceptLabel, "Line-by-line comparison");
  assert.equal(tagged[1]?.conceptId, "l1-line");
  assert.equal(tagged[2]?.conceptId, undefined);
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

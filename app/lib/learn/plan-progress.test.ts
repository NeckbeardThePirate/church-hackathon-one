import assert from "node:assert/strict";
import test from "node:test";
import { mergeLearnProgress, normalizeLearnProgress, type ConceptMastery } from "./plan-progress.ts";
import { normalizeStoredProject, type Project } from "../projects.ts";
import { lessonKind } from "./types.ts";

const answer = {
  mcChoice: "By faith",
  shortText: "grace",
  shortSubmitted: true,
  correct: false as boolean | null,
};

const savedFields = {
  location: { screen: "lesson" as const, lessonId: "l1" },
  lessonReadScroll: { l1: 42, l2: 0 },
  lessonReadDone: { l1: true, l2: false },
  lessonQuiz: { l1: { answers: [answer, { mcChoice: null, shortText: "", shortSubmitted: false, correct: null }] } },
  finalQuiz: { answers: [{ mcChoice: "A", shortText: "", shortSubmitted: false, correct: true }] },
  articleScroll: { "https://ex.test/a": 15 },
  articleDone: { "https://ex.test/a": true, "https://ex.test/b": false },
};

function mastery(over: Partial<ConceptMastery> = {}): ConceptMastery {
  return {
    conceptId: "l2-justification",
    conceptLabel: "Justification",
    lessonId: "l2",
    easiness: 2.2,
    repetitions: 2,
    intervalDays: 3,
    dueAt: 123,
    lastQuality: 4,
    lastReviewedAt: 50,
    correctStreak: 2,
    gapPlanId: "gap-1",
    ...over,
  };
}

test("v2 progress upgrades to v3 with empty conceptMastery and keeps quiz, read, and article fields", () => {
  const next = normalizeLearnProgress({ v: 2, ...savedFields });
  assert.equal(next.v, 3);
  assert.deepEqual(next.conceptMastery, {});
  assert.deepEqual(next.location, savedFields.location);
  assert.deepEqual(next.lessonReadScroll, savedFields.lessonReadScroll);
  assert.deepEqual(next.lessonReadDone, savedFields.lessonReadDone);
  assert.deepEqual(next.lessonQuiz, savedFields.lessonQuiz);
  assert.deepEqual(next.finalQuiz, savedFields.finalQuiz);
  assert.deepEqual(next.articleScroll, savedFields.articleScroll);
  assert.deepEqual(next.articleDone, savedFields.articleDone);
  assert.deepEqual(normalizeLearnProgress(next), next);
});

test("unversioned progress upgrades to v3 without dropping saved fields", () => {
  const next = normalizeLearnProgress({ ...savedFields });
  assert.equal(next.v, 3);
  assert.deepEqual(next.conceptMastery, {});
  assert.deepEqual(next.lessonQuiz, savedFields.lessonQuiz);
  assert.deepEqual(next.lessonReadDone, savedFields.lessonReadDone);
  assert.deepEqual(next.articleDone, savedFields.articleDone);
  assert.equal(next.finalQuiz?.answers[0]?.correct, true);
});

test("legacy unversioned flags still map onto read state", () => {
  const next = normalizeLearnProgress({
    lessonQuizDone: { l1: true },
    lessonViewed: { l2: true },
    finalQuizDone: true,
  });
  assert.equal(next.v, 3);
  assert.deepEqual(next.conceptMastery, {});
  assert.equal(next.lessonReadDone.l1, true);
  assert.equal(next.lessonReadDone.l2, true);
  assert.equal(next.lessonReadDone.__final__, true);
  assert.deepEqual(next.lessonQuiz, {});
});

test("a modern payload also keeps a legacy read flag that was not copied forward", () => {
  const next = normalizeLearnProgress({
    lessonQuiz: savedFields.lessonQuiz,
    lessonQuizDone: { l9: true },
  });
  assert.deepEqual(next.lessonQuiz, savedFields.lessonQuiz);
  assert.equal(next.lessonReadDone.l9, true);
});

test("existing conceptMastery is kept, including scheduling fields", () => {
  const row = mastery();
  const next = normalizeLearnProgress({ v: 3, ...savedFields, conceptMastery: { [row.conceptId]: row } });
  assert.deepEqual(next.conceptMastery[row.conceptId], row);
});

test("mergeLearnProgress loads v2 and v3 project progress instead of ignoring it", () => {
  const fromV2 = mergeLearnProgress({ v: 2, ...savedFields }, "missing-local");
  assert.equal(fromV2.v, 3);
  assert.equal(fromV2.location.lessonId, "l1");
  const fromV3 = mergeLearnProgress(
    { v: 3, ...savedFields, conceptMastery: { "l2-justification": mastery() } },
    "missing-local",
  );
  assert.equal(fromV3.conceptMastery["l2-justification"]?.easiness, 2.2);
  assert.equal(mergeLearnProgress(undefined, "missing-local").v, 3);
});

test("stored learn plans default missing lesson kind to core and still load quiz items without concept ids", () => {
  const archived = {
    id: "old",
    kind: "lesson",
    title: "Archived lesson",
    blocks: [{ id: "b1", type: "paragraph", html: "<p>Kept</p>" }],
    updatedAt: 5,
    importComplete: true,
  } as Project;
  assert.equal(normalizeStoredProject(archived), archived);

  const learn = {
    id: "path",
    kind: "learn",
    title: "Justification",
    blocks: [],
    updatedAt: 5,
    importComplete: true,
    learnPlan: {
      id: "plan",
      lessons: [
        {
          id: "l1",
          quiz: [{ kind: "mc", question: "What justifies?", choices: ["Faith"], answer: "Faith", rationale: "", objectiveIndex: 0 }],
        },
        { id: "g1", kind: "gap", sourceLessonId: "l1", sourceConceptIds: ["l1-faith"], quiz: [] },
      ],
    },
    learnProgress: { v: 2, ...savedFields },
  } as unknown as Project;

  const next = normalizeStoredProject(learn);
  assert.equal(lessonKind(next.learnPlan!.lessons[0]!), "core");
  assert.equal(next.learnPlan!.lessons[0]!.kind, "core");
  assert.equal(next.learnPlan!.lessons[0]!.quiz[0]!.question, "What justifies?");
  assert.equal(next.learnPlan!.lessons[0]!.quiz[0]!.conceptId, undefined);
  assert.equal(next.learnPlan!.lessons[1]!.kind, "gap");
  assert.equal(next.learnPlan!.lessons[1]!.sourceLessonId, "l1");
  assert.deepEqual(next.learnPlan!.lessons[1]!.sourceConceptIds, ["l1-faith"]);
  assert.equal(next.learnProgress?.v, 3);
  assert.deepEqual(next.learnProgress?.lessonQuiz, savedFields.lessonQuiz);
});

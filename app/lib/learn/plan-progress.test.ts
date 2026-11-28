import assert from "node:assert/strict";
import test from "node:test";
import {
  claimLegacyProgress,
  emptyLearnProgress,
  emptyQuiz,
  isLessonStepComplete,
  mergeLearnProgress,
  normalizeLearnProgress,
  normalizeQuiz,
  quizAllAnswered,
  quizAnswerSubmitted,
  quizCorrectCount,
  releaseUntouchedAnswer,
  retryMissedQuiz,
  writeLearnProgress,
  type ConceptMastery,
} from "./plan-progress.ts";
import { adoptProgressForScope, lessonQuizFor } from "./progress-scope.ts";
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

test("mergeLearnProgress keeps a claimed path and hides that payload on another path", () => {
  const ruth = { projectId: "path-ruth", planId: "plan-ruth" };
  const jonah = { projectId: "path-jonah", planId: "plan-jonah" };
  const claimed = claimLegacyProgress([
    {
      id: ruth.projectId,
      updatedAt: 10,
      learnPlan: { id: ruth.planId, createdAt: 10 },
      learnProgress: normalizeLearnProgress({ v: 2, ...savedFields }),
    },
  ]);
  const stored = claimed[0]?.learnProgress;
  const loaded = mergeLearnProgress(stored, ruth);
  assert.equal(loaded.v, 3);
  assert.equal(loaded.location.lessonId, "l1");
  assert.equal(lessonQuizFor(loaded, ruth, "l1")?.answers[0]?.shortText, "grace");
  const other = mergeLearnProgress(stored, jonah);
  assert.equal(lessonQuizFor(other, jonah, "l1"), undefined);
  assert.equal(other.finalQuiz, null);
  assert.equal(mergeLearnProgress(undefined, jonah).v, 3);
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

test("try again clears every answer, including one that was correct, and the lesson stays complete", () => {
  const quiz = {
    answers: [
      { mcChoice: "A", shortText: "", shortSubmitted: false, correct: true as boolean | null },
      { mcChoice: "B", shortText: "", shortSubmitted: false, correct: false as boolean | null },
      { mcChoice: null, shortText: "hesed", shortSubmitted: true, correct: false as boolean | null, score: 0.2 },
      { mcChoice: "D", shortText: "", shortSubmitted: false, correct: true as boolean | null },
    ],
  };
  const retried = retryMissedQuiz(quiz);
  assert.equal(retried.answers.every((answer) => answer.correct === null && answer.mcChoice === null && answer.shortText === ""), true);
  assert.equal(retried.answers[2]?.shortSubmitted, false);
  assert.equal(retried.answers[2]?.score, undefined);
  assert.equal(retried.bestCorrect, 2);
  assert.equal(retried.settled, true);

  const scope = { projectId: "path-ruth", planId: "plan-ruth" };
  const progress = adoptProgressForScope(
    normalizeLearnProgress({
      v: 3,
      lessonReadDone: { l1: true },
      lessonQuiz: { l1: retried },
    }),
    scope,
  );
  assert.equal(isLessonStepComplete(scope, "l1", true, progress), true);
  assert.equal(isLessonStepComplete({ projectId: "path-jonah", planId: "plan-jonah" }, "l1", true, progress), false);
});

test("a settled retry is not replaced by the correct answer stored earlier", () => {
  const scope = { projectId: "path-retry", planId: "plan-retry" };
  const remote = adoptProgressForScope(
    normalizeLearnProgress({
      v: 3,
      lessonQuiz: {
        l1: {
          answers: [
            { mcChoice: "A", shortText: "", shortSubmitted: false, correct: true },
            { mcChoice: "B", shortText: "", shortSubmitted: false, correct: false },
            { mcChoice: "C", shortText: "", shortSubmitted: false, correct: false },
            { mcChoice: "D", shortText: "", shortSubmitted: false, correct: true },
          ],
          bestCorrect: 2,
          settled: true,
        },
      },
    }),
    scope,
  );
  const saved = lessonQuizFor(remote, scope, "l1");
  assert.ok(saved);
  const local = {
    ...remote,
    lessonQuiz: { ...remote.lessonQuiz, [Object.keys(remote.lessonQuiz)[0]!]: retryMissedQuiz(saved) },
  };
  const store = new Map<string, string>();
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  } as unknown as Window & typeof globalThis;
  try {
    writeLearnProgress(scope.projectId, local);
    const merged = mergeLearnProgress(remote, scope);
    const quiz = lessonQuizFor(merged, scope, "l1");
    assert.equal(quiz?.answers[0]?.correct, null);
    assert.equal(quiz?.answers[3]?.correct, null);
    assert.equal(quiz?.answers[3]?.mcChoice, null);
    assert.equal(quiz?.bestCorrect, 2);
    assert.equal(quiz?.settled, true);
  } finally {
    globalThis.window = previous;
  }
});

test("an untouched free-text grade does not count and loses its feedback", () => {
  const untouched = { mcChoice: null, shortText: "", shortSubmitted: false, correct: false as boolean | null, score: 0 };
  assert.equal(quizAnswerSubmitted(untouched), false);
  const released = releaseUntouchedAnswer(untouched);
  assert.equal(released.correct, null);
  assert.equal(released.score, undefined);
  assert.equal(released.shortSubmitted, false);

  const quiz = normalizeQuiz(
    {
      answers: [
        { mcChoice: "Yes", shortText: "", shortSubmitted: false, correct: true },
        { mcChoice: "No", shortText: "", shortSubmitted: false, correct: true },
        untouched,
        { mcChoice: null, shortText: "still typing", shortSubmitted: false, correct: false, score: 0 },
      ],
    },
    4,
  );
  assert.equal(quizCorrectCount(quiz), 2);
  assert.equal(quizAllAnswered(quiz), false);
  assert.equal(quiz.answers[2]?.correct, null);
  assert.equal(quiz.answers[3]?.correct, null);
  assert.equal(quiz.answers[3]?.shortText, "still typing");
  assert.equal(quizAnswerSubmitted({ mcChoice: null, shortText: "born of the Spirit", shortSubmitted: true, correct: false }), true);
  assert.equal(quizAllAnswered(emptyQuiz(1)), false);
});

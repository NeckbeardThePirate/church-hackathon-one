import assert from "node:assert/strict";
import test from "node:test";
import { mirrorAttemptOntoProgress } from "./attempts.ts";
import { claimLegacyProgress, isFinalStepComplete, isLessonStepComplete, normalizeLearnProgress } from "./plan-progress.ts";
import {
  adoptProgressForScope,
  finalQuizFor,
  lessonQuizFor,
  readDoneFor,
  readScrollFor,
} from "./progress-scope.ts";

const ruthAnswer = {
  mcChoice: null,
  shortText: "Ruth stayed with Naomi",
  shortSubmitted: true,
  correct: true,
};

function legacyProgress() {
  return normalizeLearnProgress({
    v: 3,
    location: { screen: "final" },
    lessonReadScroll: { l1: 100, l2: 80, l3: 40, l4: 10 },
    lessonReadDone: { l1: true, l2: true },
    lessonQuiz: {
      l1: {
        bestCorrect: 4,
        settled: true,
        answers: [
          { mcChoice: "A", shortText: "", shortSubmitted: false, correct: true },
          { mcChoice: "B", shortText: "", shortSubmitted: false, correct: true },
          { mcChoice: "C", shortText: "", shortSubmitted: false, correct: true },
          { mcChoice: "D", shortText: "", shortSubmitted: false, correct: true },
        ],
      },
    },
    finalQuiz: {
      bestCorrect: 4,
      settled: true,
      answers: [
        { mcChoice: "Boaz", shortText: "", shortSubmitted: false, correct: true },
        ruthAnswer,
        { mcChoice: "Bethlehem", shortText: "", shortSubmitted: false, correct: true },
        { mcChoice: "Naomi", shortText: "", shortSubmitted: false, correct: true },
      ],
    },
  });
}

const ruth = { projectId: "path-ruth", planId: "plan-ruth" };
const jonah = { projectId: "path-jonah", planId: "plan-jonah" };

test("two paths with the same lesson ids do not share reading, quizzes, try again, or the final", () => {
  const stored = legacyProgress();
  const projects = claimLegacyProgress([
    {
      id: ruth.projectId,
      updatedAt: 2_000,
      learnPlan: { id: ruth.planId, createdAt: 1_000 },
      learnProgress: stored,
    },
    {
      id: jonah.projectId,
      updatedAt: 5_000,
      learnPlan: { id: jonah.planId, createdAt: 4_000 },
      learnProgress: stored,
    },
  ]);
  const ruthProgress = projects[0]!.learnProgress!;
  const jonahProgress = projects[1]!.learnProgress!;

  assert.equal(readScrollFor(ruthProgress, ruth, "l1"), 100);
  assert.equal(readDoneFor(ruthProgress, ruth, "l2"), true);
  assert.equal(lessonQuizFor(ruthProgress, ruth, "l1")?.bestCorrect, 4);
  assert.equal(lessonQuizFor(ruthProgress, ruth, "l1")?.settled, true);
  assert.equal(isLessonStepComplete(ruth, "l1", true, ruthProgress), true);
  assert.equal(finalQuizFor(ruthProgress, ruth)?.answers[1]?.shortText, "Ruth stayed with Naomi");
  assert.equal(finalQuizFor(ruthProgress, ruth)?.answers.filter((answer) => answer.correct === true).length, 4);
  assert.equal(isFinalStepComplete(ruth, ruthProgress, true), true);

  for (const lessonId of ["l1", "l2", "l3", "l4"]) {
    assert.equal(readScrollFor(jonahProgress, jonah, lessonId), 0);
    assert.equal(readDoneFor(jonahProgress, jonah, lessonId), false);
    assert.equal(lessonQuizFor(jonahProgress, jonah, lessonId), undefined);
    assert.equal(isLessonStepComplete(jonah, lessonId, true, jonahProgress), false);
  }
  assert.equal(finalQuizFor(jonahProgress, jonah), null);
  assert.equal(isFinalStepComplete(jonah, jonahProgress, true), false);
  assert.equal(jonahProgress.finalQuiz, null);
  assert.equal(JSON.stringify(jonahProgress).includes("Ruth stayed with Naomi"), false);

  const again = claimLegacyProgress(projects);
  assert.equal(JSON.stringify(again), JSON.stringify(projects));
  assert.equal(finalQuizFor(again[0]!.learnProgress, ruth)?.answers[1]?.shortText, "Ruth stayed with Naomi");
  assert.equal(finalQuizFor(again[1]!.learnProgress, jonah), null);
});

test("a copied scoped blob is not shown on the path it was pasted onto", () => {
  const [ruthProject] = claimLegacyProgress([
    {
      id: ruth.projectId,
      updatedAt: 2_000,
      learnPlan: { id: ruth.planId, createdAt: 1_000 },
      learnProgress: legacyProgress(),
    },
  ]);
  const pasted = claimLegacyProgress([
    ruthProject!,
    {
      id: jonah.projectId,
      updatedAt: 9_000,
      learnPlan: { id: jonah.planId, createdAt: 8_000 },
      learnProgress: ruthProject!.learnProgress,
    },
  ]);
  assert.equal(finalQuizFor(pasted[1]?.learnProgress, jonah), null);
  assert.equal(JSON.stringify(pasted[1]?.learnProgress).includes("Ruth stayed with Naomi"), false);
  assert.equal(finalQuizFor(pasted[0]?.learnProgress, ruth)?.answers[1]?.shortText, "Ruth stayed with Naomi");
});

test("a lesson attempt stored for one plan does not land on another plan with the same lesson id", () => {
  const scope = ruth;
  const ruthProgress = mirrorAttemptOntoProgress(
    { v: 3 },
    {
      target: "lesson",
      lessonId: "l1",
      answers: [{ mcChoice: "Orpah", shortText: "", shortSubmitted: false, correct: false, conceptId: "l1-return" }],
    },
    {},
    scope,
  );
  const jonahProgress = adoptProgressForScope(normalizeLearnProgress({ v: 3 }), jonah);
  assert.equal(lessonQuizFor(ruthProgress, ruth, "l1")?.answers[0]?.mcChoice, "Orpah");
  assert.equal(lessonQuizFor(jonahProgress, jonah, "l1"), undefined);
  assert.equal(lessonQuizFor(ruthProgress, jonah, "l1"), undefined);

  const final = mirrorAttemptOntoProgress(
    ruthProgress,
    {
      target: "final",
      answers: [ruthAnswer],
    },
    {},
    ruth,
  );
  assert.equal(finalQuizFor(final, ruth)?.answers[0]?.shortText, "Ruth stayed with Naomi");
  assert.equal(finalQuizFor(final, jonah), null);
});

test("unique legacy progress stays on the path that stored it", () => {
  const [kept] = claimLegacyProgress([
    {
      id: jonah.projectId,
      updatedAt: 50,
      learnPlan: { id: jonah.planId, createdAt: 40 },
      learnProgress: legacyProgress(),
    },
  ]);
  assert.equal(finalQuizFor(kept?.learnProgress, jonah)?.answers[1]?.shortText, "Ruth stayed with Naomi");
  assert.equal(readScrollFor(kept!.learnProgress!, jonah, "l4"), 10);
});

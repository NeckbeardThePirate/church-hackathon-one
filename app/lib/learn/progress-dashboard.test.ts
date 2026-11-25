import assert from "node:assert/strict";
import test from "node:test";
import { emptyLearnProgress, newConceptMastery, type LearnPlanProgress } from "./plan-progress.ts";
import { actionTarget, nextLearningAction, pathSummaries, type DashboardProject } from "./progress-dashboard.ts";
import { withConceptMastery, withLessonQuiz, type ProgressScope } from "./progress-scope.ts";
import type { LearnLesson, QuizItem } from "./types.ts";

const now = Date.parse("2026-11-23T20:00:00Z");

function questions(count: number, prefix: string): QuizItem[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "mc" as const,
    question: `${prefix} question ${index + 1}`,
    choices: ["Yes", "No"],
    answer: "Yes",
    rationale: "The lesson says yes.",
    objectiveIndex: 0,
    conceptId: `${prefix}-c${index + 1}`,
    conceptLabel: `${prefix} concept ${index + 1}`,
  }));
}

function lesson(over: Partial<LearnLesson> & Pick<LearnLesson, "id" | "order" | "title">): LearnLesson {
  return {
    objectives: ["Explain the idea"],
    prerequisiteLessonIds: [],
    estimatedMinutes: 20,
    searchHints: [],
    status: "ok",
    teaching: [],
    videos: [],
    articles: [],
    books: [],
    scripture: [],
    quiz: questions(3, over.id),
    warnings: [],
    ...over,
  };
}

function passedQuiz(scope: ProgressScope, progress: LearnPlanProgress, lessonId: string): LearnPlanProgress {
  return withLessonQuiz(progress, scope, lessonId, {
    settled: true,
    bestCorrect: 3,
    answers: [0, 1, 2].map(() => ({ mcChoice: "Yes", shortText: "", shortSubmitted: false, correct: true })),
  });
}

function project(over: Partial<DashboardProject> & Pick<DashboardProject, "id" | "title">): DashboardProject {
  return {
    updatedAt: now,
    learnPlan: {
      id: `plan-${over.id}`,
      lessons: [lesson({ id: "l1", order: 1, title: "Ruth's loyalty" })],
    },
    learnProgress: emptyLearnProgress(),
    ...over,
  };
}

test("next action is due reviews, then a gap lesson, then the next lesson", () => {
  const open = project({ id: "path-open", title: "Open path", updatedAt: now });
  assert.equal(nextLearningAction([open], now).kind, "lesson");
  assert.equal(nextLearningAction([open], now).label, "Ruth's loyalty");

  const scope = { projectId: "path-gap", planId: "plan-path-gap" };
  let gapProgress = emptyLearnProgress();
  gapProgress = passedQuiz(scope, gapProgress, "l1");
  const gap = project({
    id: "path-gap",
    title: "Gap path",
    updatedAt: now - 1,
    learnPlan: {
      id: "plan-path-gap",
      lessons: [
        lesson({ id: "l1", order: 1, title: "Core" }),
        lesson({ id: "gap-1", order: 2, title: "Practice: mercy", kind: "gap", sourceLessonId: "l1", quiz: questions(1, "gap") }),
      ],
    },
    learnProgress: gapProgress,
  });
  const gapAction = nextLearningAction([gap, open], now);
  assert.equal(gapAction.kind, "gap");
  if (gapAction.kind === "gap") assert.equal(gapAction.lessonId, "gap-1");

  let dueProgress = emptyLearnProgress();
  dueProgress = withConceptMastery(
    dueProgress,
    { projectId: "path-due", planId: "plan-path-due" },
    "l1-c1",
    { ...newConceptMastery({ conceptId: "l1-c1", conceptLabel: "Loyalty", lessonId: "l1" }), dueAt: now - 1000, repetitions: 1 },
  );
  const due = project({
    id: "path-due",
    title: "Due path",
    updatedAt: now - 2,
    learnPlan: { id: "plan-path-due", lessons: [lesson({ id: "l1", order: 1, title: "Review me" })] },
    learnProgress: dueProgress,
  });
  const review = nextLearningAction([open, gap, due], now);
  assert.equal(review.kind, "reviews");
  if (review.kind === "reviews") {
    assert.equal(review.projectId, "path-due");
    assert.equal(review.count, 1);
    assert.equal(review.label, "Review 1 due");
  }
  assert.deepEqual(actionTarget(review), {
    projectId: "path-due",
    location: { screen: "overview" },
    review: true,
  });
});

test("an earlier due review wins, and a finished path points at the final", () => {
  const older = project({
    id: "older",
    title: "Older",
    updatedAt: now - 5,
    learnProgress: withConceptMastery(
      emptyLearnProgress(),
      { projectId: "older", planId: "plan-older" },
      "l1-c1",
      { ...newConceptMastery({ conceptId: "l1-c1", conceptLabel: "A", lessonId: "l1" }), dueAt: now - 50_000, repetitions: 1 },
    ),
  });
  const newer = project({
    id: "newer",
    title: "Newer",
    updatedAt: now,
    learnProgress: withConceptMastery(
      emptyLearnProgress(),
      { projectId: "newer", planId: "plan-newer" },
      "l1-c1",
      { ...newConceptMastery({ conceptId: "l1-c1", conceptLabel: "B", lessonId: "l1" }), dueAt: now - 1000, repetitions: 1 },
    ),
  });
  const chosen = nextLearningAction([newer, older], now);
  assert.equal(chosen.kind, "reviews");
  if (chosen.kind === "reviews") assert.equal(chosen.projectId, "older");

  const scope = { projectId: "done", planId: "plan-done" };
  const done = project({
    id: "done",
    title: "Done",
    learnPlan: {
      id: "plan-done",
      lessons: [lesson({ id: "l1", order: 1, title: "Finished" })],
      finalAssessment: questions(3, "final"),
    },
    learnProgress: passedQuiz(scope, emptyLearnProgress(), "l1"),
  });
  const finalAction = nextLearningAction([done], now);
  assert.equal(finalAction.kind, "final");
  assert.equal(finalAction.label, "Final assessment");

  const summaries = pathSummaries([done, older], now);
  const doneSummary = summaries.find((item) => item.projectId === "done");
  const olderSummary = summaries.find((item) => item.projectId === "older");
  assert.equal(doneSummary?.percent, 50);
  assert.equal(olderSummary?.reviewsDue, 1);
  assert.equal(nextLearningAction([], now).kind, "none");
});

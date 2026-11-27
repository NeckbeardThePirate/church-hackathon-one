import assert from "node:assert/strict";
import test from "node:test";
import { emptyLearnProgress, isLessonStepComplete, newConceptMastery, normalizeLearnProgress, type LearnPlanProgress } from "./plan-progress.ts";
import { withConceptMastery, withFinalQuiz, withLessonQuiz, withReadState, type ProgressScope } from "./progress-scope.ts";
import { attemptPassed, derivePathMap, requiredCorrect, type PathMapNode } from "./path-map.ts";
import type { LearnLesson, QuizItem } from "./types.ts";

const scope: ProgressScope = { projectId: "path-1", planId: "plan-1" };
const now = 1_700_000_000_000;

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

function questions(count: number, prefix: string): QuizItem[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "mc" as const,
    question: `Question ${index + 1}`,
    choices: ["Yes", "No"],
    answer: "Yes",
    rationale: "The lesson says yes.",
    objectiveIndex: 0,
    conceptId: `${prefix}-c${index + 1}`,
    conceptLabel: `Concept ${index + 1}`,
  }));
}

function submitted(itemCount: number, correct: number): LearnPlanProgress["lessonQuiz"][string] {
  return {
    settled: true,
    bestCorrect: correct,
    answers: Array.from({ length: itemCount }, (_, index) => ({
      mcChoice: "Yes",
      shortText: "",
      shortSubmitted: false,
      correct: index < correct,
    })),
  };
}

function mapOf(
  lessons: LearnLesson[],
  progress: LearnPlanProgress = emptyLearnProgress(),
  finalCount = 0,
): PathMapNode[] {
  return derivePathMap({
    lessons,
    finalAssessment: Array.from({ length: finalCount }, (_, index) => ({ conceptId: `final-c${index + 1}` })),
    progress,
    scope,
    now,
  });
}

function states(nodes: PathMapNode[]): Record<string, string> {
  return Object.fromEntries(nodes.map((node) => [node.id, node.state]));
}

test("80% rounded down, with all-but-one on a 3-item quiz", () => {
  assert.equal(requiredCorrect(3), 2);
  assert.equal(attemptPassed(1, 3), false);
  assert.equal(attemptPassed(2, 3), true);
  assert.equal(requiredCorrect(4), 3);
  assert.equal(attemptPassed(2, 4), false);
  assert.equal(attemptPassed(3, 4), true);
  assert.equal(requiredCorrect(5), 4);
  assert.equal(attemptPassed(3, 5), false);
  assert.equal(attemptPassed(4, 5), true);
  assert.equal(requiredCorrect(6), 4);
  assert.equal(attemptPassed(3, 6), false);
  assert.equal(attemptPassed(4, 6), true);
  assert.equal(requiredCorrect(1), 1);
  assert.equal(attemptPassed(0, 1), false);
  assert.equal(attemptPassed(1, 1), true);
  assert.equal(requiredCorrect(0), 0);
  assert.equal(attemptPassed(0, 0), false);
});

test("a pending lesson is still building, and a finished lesson is not", () => {
  const nodes = mapOf([
    lesson({ id: "l1", order: 1, title: "Foundations", status: "ok" }),
    lesson({
      id: "l2",
      order: 2,
      title: "Practice",
      status: "pending",
      teaching: [],
      quiz: [],
      prerequisiteLessonIds: ["l1"],
    }),
  ]);
  assert.equal(nodes[0]?.building, false);
  assert.equal(nodes[1]?.building, true);
  assert.equal(nodes[1]?.state, "locked");
});

test("a path with no gap lessons follows order and locks on prerequisite titles", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Foundations" }),
    lesson({ id: "l2", order: 2, title: "Practice", prerequisiteLessonIds: ["l1"] }),
    lesson({ id: "l3", order: 3, title: "Review", prerequisiteLessonIds: ["l2"] }),
  ];
  const nodes = mapOf(lessons, emptyLearnProgress(), 6);
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["l1", "l2", "l3", "final"],
  );
  assert.deepEqual(states(nodes), {
    l1: "available",
    l2: "locked",
    l3: "locked",
    final: "locked",
  });
  assert.equal(nodes[0]?.current, true);
  assert.deepEqual(nodes[1]?.unmet, [{ id: "l1", title: "Foundations" }]);
  assert.deepEqual(nodes[2]?.unmet, [{ id: "l2", title: "Practice" }]);
  assert.deepEqual(
    nodes[3]?.unmet.map((item) => item.title),
    ["Foundations", "Practice", "Review"],
  );
  assert.equal(nodes.every((node) => node.kind !== "gap"), true);
});

test("a gap appended to the plan hangs after its parent and before the next core lesson", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Foundations" }),
    lesson({ id: "l2", order: 2, title: "Practice", prerequisiteLessonIds: ["l1"] }),
    lesson({
      id: "g-late",
      order: 50,
      title: "Extra practice",
      kind: "gap",
      sourceLessonId: "l1",
      sourceConceptIds: ["l1-c1"],
      prerequisiteLessonIds: [],
      quiz: questions(3, "g-late"),
    }),
    lesson({
      id: "g-early",
      order: 1,
      title: "First gap",
      kind: "gap",
      sourceLessonId: "l1",
      prerequisiteLessonIds: [],
    }),
  ];
  const nodes = mapOf(lessons);
  assert.deepEqual(
    nodes.map((node) => [node.id, node.kind, node.parentId]),
    [
      ["l1", "core", null],
      ["g-early", "gap", "l1"],
      ["g-late", "gap", "l1"],
      ["l2", "core", null],
    ],
  );
  assert.equal(nodes.find((node) => node.id === "g-early")?.state, "available");
});

test("a gap of a gap still hangs off the core parent", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Foundations" }),
    lesson({ id: "g1", order: 2, title: "Gap", kind: "gap", sourceLessonId: "l1", prerequisiteLessonIds: [] }),
    lesson({ id: "g2", order: 3, title: "Nested gap", kind: "gap", sourceLessonId: "g1", prerequisiteLessonIds: [] }),
    lesson({ id: "l2", order: 4, title: "Next", prerequisiteLessonIds: ["l1"] }),
  ];
  const nodes = mapOf(lessons);
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["l1", "g1", "g2", "l2"],
  );
  assert.equal(nodes[1]?.parentId, "l1");
  assert.equal(nodes[2]?.parentId, "l1");
});

test("finishing a quiz masters the node or marks it for review in the stored progress", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Foundations" }),
    lesson({ id: "l2", order: 2, title: "Practice", prerequisiteLessonIds: ["l1"], quiz: questions(4, "l2") }),
    lesson({ id: "l3", order: 3, title: "Stretch", prerequisiteLessonIds: ["l1"], quiz: questions(5, "l3") }),
    lesson({ id: "l4", order: 4, title: "Broad", prerequisiteLessonIds: ["l1"], quiz: questions(6, "l4") }),
  ];
  let progress = emptyLearnProgress();
  progress = withLessonQuiz(progress, scope, "l1", submitted(3, 2));
  progress = withLessonQuiz(progress, scope, "l2", submitted(4, 3));
  progress = withLessonQuiz(progress, scope, "l3", submitted(5, 3));
  progress = withLessonQuiz(progress, scope, "l4", submitted(6, 4));
  const nodes = mapOf(lessons, progress);
  assert.equal(nodes.find((node) => node.id === "l1")?.state, "mastered");
  assert.equal(nodes.find((node) => node.id === "l2")?.state, "mastered");
  assert.equal(nodes.find((node) => node.id === "l3")?.state, "needs-review");
  assert.equal(nodes.find((node) => node.id === "l4")?.state, "mastered");
  assert.equal(nodes.find((node) => node.id === "l3")?.current, true);
});

test("a settled miss is needs review even when the lesson step is complete", () => {
  const lessons = [lesson({ id: "l1", order: 1, title: "Foundations" })];
  const progress = withReadState(withLessonQuiz(emptyLearnProgress(), scope, "l1", submitted(3, 1)), scope, "l1", 100, true);
  assert.equal(isLessonStepComplete(scope, "l1", true, progress), true);
  assert.equal(mapOf(lessons, progress)[0]?.state, "needs-review");
});

test("a passing quiz masters the node before the lesson is marked read", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Foundations" }),
    lesson({ id: "l2", order: 2, title: "Practice", prerequisiteLessonIds: ["l1"] }),
  ];
  const progress = withLessonQuiz(emptyLearnProgress(), scope, "l1", submitted(3, 3));
  assert.equal(isLessonStepComplete(scope, "l1", true, progress), false);
  const nodes = mapOf(lessons, progress);
  assert.equal(nodes[0]?.state, "mastered");
  assert.equal(nodes[1]?.state, "available");
  assert.equal(nodes[1]?.current, true);
});

test("an unfinished quiz stays in progress and does not unlock the next lesson", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Foundations" }),
    lesson({ id: "l2", order: 2, title: "Practice", prerequisiteLessonIds: ["l1"] }),
  ];
  const progress = withLessonQuiz(emptyLearnProgress(), scope, "l1", {
    answers: [
      { mcChoice: "Yes", shortText: "", shortSubmitted: false, correct: true },
      { mcChoice: "Yes", shortText: "", shortSubmitted: false, correct: true },
      { mcChoice: null, shortText: "", shortSubmitted: false, correct: null },
    ],
  });
  const nodes = mapOf(lessons, progress);
  assert.equal(nodes[0]?.state, "in-progress");
  assert.equal(nodes[0]?.current, true);
  assert.equal(nodes[1]?.state, "locked");
  assert.equal(nodes[1]?.unmet[0]?.title, "Foundations");
});

test("reading without a quiz moves available to in progress, then mastered", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Read only", quiz: [] }),
    lesson({ id: "l2", order: 2, title: "Next", prerequisiteLessonIds: ["l1"], quiz: [] }),
  ];
  const started = withReadState(emptyLearnProgress(), scope, "l1", 40, false);
  assert.equal(mapOf(lessons, started)[0]?.state, "in-progress");
  assert.equal(mapOf(lessons, started)[1]?.state, "locked");
  const done = withReadState(emptyLearnProgress(), scope, "l1", 100, true);
  const nodes = mapOf(lessons, done);
  assert.equal(nodes[0]?.state, "mastered");
  assert.equal(nodes[1]?.state, "available");
});

test("retry keeps a passing best score, and a failing best score stays in review", () => {
  const lessons = [lesson({ id: "l1", order: 1, title: "Foundations" })];
  const cleared = {
    settled: true,
    answers: [
      { mcChoice: "Yes", shortText: "", shortSubmitted: false, correct: true as boolean | null },
      { mcChoice: null, shortText: "", shortSubmitted: false, correct: null },
      { mcChoice: null, shortText: "", shortSubmitted: false, correct: null },
    ],
  };
  assert.equal(mapOf(lessons, withLessonQuiz(emptyLearnProgress(), scope, "l1", { ...cleared, bestCorrect: 2 }))[0]?.state, "mastered");
  assert.equal(mapOf(lessons, withLessonQuiz(emptyLearnProgress(), scope, "l1", { ...cleared, bestCorrect: 1 }))[0]?.state, "needs-review");
});

test("dueAt of 0 is not due, a future due stays mastered, and a passed due flips to needs review", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Foundations" }),
    lesson({ id: "l2", order: 2, title: "Practice", prerequisiteLessonIds: ["l1"] }),
  ];
  const base = withLessonQuiz(emptyLearnProgress(), scope, "l1", submitted(3, 3));
  const row = (dueAt: number) =>
    withConceptMastery(
      base,
      scope,
      "l1-c1",
      { ...newConceptMastery({ conceptId: "l1-c1", conceptLabel: "Concept 1", lessonId: "l1" }), dueAt },
    );

  assert.equal(mapOf(lessons, row(0))[0]?.state, "mastered");
  assert.equal(mapOf(lessons, row(now + 86_400_000))[0]?.state, "mastered");
  const overdue = mapOf(lessons, row(now - 1));
  assert.equal(overdue[0]?.state, "needs-review");
  assert.equal(overdue[0]?.current, true);
  assert.equal(overdue[1]?.state, "available");
  assert.equal(overdue[1]?.unmet.length, 0);
});

test("another lesson's due concept does not change this node", () => {
  const lessons = [lesson({ id: "l1", order: 1, title: "Foundations" })];
  const progress = withConceptMastery(
    withLessonQuiz(emptyLearnProgress(), scope, "l1", submitted(3, 3)),
    scope,
    "l2-c1",
    { ...newConceptMastery({ conceptId: "l2-c1", conceptLabel: "Elsewhere", lessonId: "l2" }), dueAt: now - 1 },
  );
  assert.equal(mapOf(lessons, progress)[0]?.state, "mastered");
});

test("the final opens after every core lesson is passed and uses the same pass bar", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Foundations" }),
    lesson({ id: "l2", order: 2, title: "Practice", prerequisiteLessonIds: ["l1"] }),
  ];
  let progress = withLessonQuiz(emptyLearnProgress(), scope, "l1", submitted(3, 2));
  progress = withLessonQuiz(progress, scope, "l2", submitted(3, 2));
  const open = mapOf(lessons, progress, 6);
  assert.equal(open.find((node) => node.id === "final")?.state, "available");
  assert.equal(open.find((node) => node.id === "final")?.current, true);

  const passed = withFinalQuiz(progress, scope, submitted(6, 4));
  assert.equal(mapOf(lessons, passed, 6).find((node) => node.id === "final")?.state, "mastered");

  const missed = withFinalQuiz(progress, scope, submitted(6, 3));
  const reviewed = mapOf(lessons, missed, 6);
  assert.equal(reviewed.find((node) => node.id === "final")?.state, "needs-review");
  assert.equal(mapOf(lessons, progress, 0).some((node) => node.id === "final"), false);
});

test("an overdue final concept flips mastered back to needs review", () => {
  const lessons = [lesson({ id: "l1", order: 1, title: "Foundations", quiz: [] })];
  let progress = withReadState(emptyLearnProgress(), scope, "l1", 100, true);
  progress = withFinalQuiz(progress, scope, submitted(3, 3));
  progress = withConceptMastery(
    progress,
    scope,
    "final-c1",
    { ...newConceptMastery({ conceptId: "final-c1", conceptLabel: "Final concept", lessonId: "final" }), dueAt: now - 5 },
  );
  const nodes = mapOf(lessons, progress, 3);
  assert.equal(nodes.find((node) => node.id === "final")?.state, "needs-review");
});

test("states survive a reload of the persisted progress blob", () => {
  const lessons = [
    lesson({ id: "l1", order: 1, title: "Foundations" }),
    lesson({ id: "g1", order: 9, title: "Gap", kind: "gap", sourceLessonId: "l1", prerequisiteLessonIds: ["l1"] }),
    lesson({ id: "l2", order: 2, title: "Practice", prerequisiteLessonIds: ["l1"] }),
  ];
  let progress = withReadState(emptyLearnProgress(), scope, "l2", 15, false);
  progress = withLessonQuiz(progress, scope, "l1", submitted(3, 2));
  const before = mapOf(lessons, progress, 3);
  const reloaded = normalizeLearnProgress(JSON.parse(JSON.stringify(progress)) as unknown);
  const after = mapOf(lessons, reloaded, 3);
  assert.deepEqual(
    after.map((node) => ({ id: node.id, state: node.state, current: node.current, parentId: node.parentId })),
    before.map((node) => ({ id: node.id, state: node.state, current: node.current, parentId: node.parentId })),
  );
  assert.equal(after.find((node) => node.id === "g1")?.state, "available");
  assert.equal(after.find((node) => node.id === "g1")?.parentId, "l1");
  assert.equal(after.find((node) => node.id === "l1")?.state, "mastered");
  assert.equal(after.find((node) => node.id === "l2")?.state, "in-progress");
  assert.equal(after.find((node) => node.id === "l2")?.current, true);
});

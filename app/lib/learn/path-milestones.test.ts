import assert from "node:assert/strict";
import test from "node:test";
import { lessonIsStudyable, pathMilestones, type MilestoneState } from "./path-milestones.ts";

function states(input: Parameters<typeof pathMilestones>[0]): Record<string, MilestoneState> {
  return Object.fromEntries(pathMilestones(input).map((step) => [step.id, step.state]));
}

test("a new path starts on the outline", () => {
  assert.deepEqual(states({ lessonsDone: 0, lessonsTotal: 0, lessonOneReady: false, stage: "intake" }), {
    outline: "active",
    library: "waiting",
    "lesson-1": "waiting",
    rest: "waiting",
  });
});

test("an outline moves the lamp to the library", () => {
  assert.deepEqual(states({ lessonsDone: 0, lessonsTotal: 4, lessonOneReady: false, stage: "research" }), {
    outline: "done",
    library: "active",
    "lesson-1": "waiting",
    rest: "waiting",
  });
  assert.equal(
    pathMilestones({ lessonsDone: 0, lessonsTotal: 4, lessonOneReady: false, stage: "research" })[1]?.label,
    "Retrieving library passages",
  );
});

test("teaching Lesson 1 is its own beat", () => {
  const steps = pathMilestones({ lessonsDone: 0, lessonsTotal: 4, lessonOneReady: false, stage: "teach" });
  assert.equal(steps[2]?.state, "active");
  assert.equal(steps[2]?.label, "Building Lesson 1");
  assert.equal(steps[3]?.state, "waiting");
});

test("Lesson 1 ready keeps the rest of the path in the background", () => {
  const steps = pathMilestones({
    lessonsDone: 1,
    lessonsTotal: 4,
    lessonOneReady: true,
    stage: "teach",
    status: "running",
  });
  assert.equal(steps[2]?.state, "done");
  assert.equal(steps[2]?.detail, "Ready to start now.");
  assert.equal(steps[3]?.state, "active");
  assert.match(steps[3]?.detail ?? "", /3 lessons are still being written/);
});

test("a finished path binds the last beat", () => {
  assert.equal(
    pathMilestones({ lessonsDone: 4, lessonsTotal: 4, lessonOneReady: true, status: "complete", stage: "done" })[3]?.state,
    "done",
  );
});

test("a studyable lesson has teaching, a quiz, and is no longer pending", () => {
  assert.equal(
    lessonIsStudyable({ kind: "core", status: "ok", teaching: ["a"], quiz: ["q"] }),
    true,
  );
  assert.equal(
    lessonIsStudyable({ status: "pending", teaching: ["a"], quiz: ["q"] }),
    false,
  );
  assert.equal(
    lessonIsStudyable({ kind: "gap", status: "ok", teaching: ["a"], quiz: ["q"] }),
    false,
  );
});

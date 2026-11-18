import assert from "node:assert/strict";
import test from "node:test";
import { applyLearnAttempt, parseLearnAttempt, type LearnAttemptAnswer, type PlanAttemptRecord } from "./attempts.ts";
import { newConceptMastery, type LearnPlanProgress } from "./plan-progress.ts";
import { handleLearnAttempt } from "../server/learn/attempt-response.ts";
import { unownedPlanResponse } from "../server/learn/access.ts";
import type { Project } from "../projects.ts";

function answer(over: Partial<LearnAttemptAnswer> = {}): LearnAttemptAnswer {
  return {
    mcChoice: "Faith",
    shortText: "",
    shortSubmitted: false,
    correct: true,
    conceptId: "l1-faith",
    conceptLabel: "Faith",
    ...over,
  };
}

function projectWith(progress?: unknown, lessonIds: string[] = ["l1"]): Project {
  return {
    id: "p1",
    kind: "learn",
    title: "Justification",
    blocks: [],
    updatedAt: 10,
    importComplete: true,
    learnPlanId: "plan-1",
    learnPlan: {
      id: "plan-1",
      lessons: lessonIds.map((id) => ({ id })),
    },
    ...(progress !== undefined ? { learnProgress: progress } : {}),
  } as unknown as Project;
}

function deps(over: Partial<Parameters<typeof handleLearnAttempt>[0]> = {}) {
  const saved: { project?: Project; attempt?: PlanAttemptRecord } = {};
  let reads = 0;
  const base = {
    owned: { userId: "user_1" } as { userId: string } | Response,
    readBody: async () => ({ target: "lesson", lessonId: "l1", answers: [answer()] }),
    loadProject: async () => {
      reads += 1;
      return projectWith({ v: 2, lessonReadDone: { l1: true }, lessonQuiz: { l2: { answers: [answer({ conceptId: undefined })] } } });
    },
    loadPlanMastery: async () => {
      reads += 1;
      return {};
    },
    saveProject: async (project: Project) => {
      saved.project = project;
    },
    savePlanAttempt: async (record: PlanAttemptRecord) => {
      saved.attempt = record;
    },
    now: 1_700_000_000_000,
  };
  return { saved, get reads() { return reads; }, input: { ...base, ...over } };
}

test("unowned plans are rejected with the same 404 for missing and someone else's plan", async () => {
  const missing = unownedPlanResponse("user_1", null);
  assert.equal(missing?.status, 404);
  const body = (await missing!.json()) as { error?: string };
  assert.equal(body.error, "Plan not found");
  const other = unownedPlanResponse("user_1", { userId: "user_2" });
  assert.equal(other?.status, 404);
  assert.equal(unownedPlanResponse("user_1", { userId: "user_1" }), null);
});

test("attempt handler returns 401 and 404 without reading or storing", async () => {
  for (const status of [401, 404]) {
    let called = false;
    const res = await handleLearnAttempt({
      owned: Response.json({ error: status === 401 ? "Sign in required." : "Plan not found" }, { status }),
      readBody: async () => {
        called = true;
        return {};
      },
      loadProject: async () => {
        called = true;
        return null;
      },
      loadPlanMastery: async () => {
        called = true;
        return {};
      },
      saveProject: async () => {
        called = true;
      },
      savePlanAttempt: async () => {
        called = true;
      },
    });
    assert.equal(res.status, status);
    assert.equal(called, false);
  }
});

test("invalid attempt bodies are rejected before storage", async () => {
  const bad = deps({ readBody: async () => ({ target: "quiz" }) });
  const res = await handleLearnAttempt(bad.input);
  assert.equal(res.status, 400);
  assert.equal(bad.reads, 0);
  assert.equal(bad.saved.attempt, undefined);

  const parsed = parseLearnAttempt({
    target: "lesson",
    lessonId: "l1",
    answers: [{ conceptId: "not a slug", mcChoice: null, shortText: "", shortSubmitted: false, correct: null }],
  });
  assert.equal(parsed.ok, false);
});

test("a lesson attempt stores answers, initializes mastery, and leaves existing rows alone", async () => {
  const existing = newConceptMastery({ conceptId: "l1-law", conceptLabel: "Law", lessonId: "l1" });
  existing.easiness = 2.1;
  existing.dueAt = 50;
  const harness = deps({
    readBody: async () => ({
      target: "lesson",
      lessonId: "l1",
      answers: [answer(), answer({ conceptId: "l1-law", conceptLabel: "Law", correct: false })],
    }),
    loadProject: async () =>
      projectWith({
        v: 2,
        lessonReadDone: { l1: true },
        lessonQuiz: { l2: { answers: [{ mcChoice: "x", shortText: "", shortSubmitted: false, correct: true }] } },
        conceptMastery: { "l1-law": existing },
      }),
  });
  const res = await handleLearnAttempt(harness.input);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { conceptMastery: LearnPlanProgress["conceptMastery"] };
  const faith = body.conceptMastery["l1-faith"];
  assert.ok(faith);
  assert.equal(faith.conceptLabel, "Faith");
  assert.equal(faith.lessonId, "l1");
  assert.equal(faith.easiness, 2.5);
  assert.equal(faith.dueAt, 0);
  assert.equal(faith.repetitions, 0);
  assert.equal(faith.intervalDays, 0);
  assert.equal(faith.lastQuality, null);
  assert.equal(faith.lastReviewedAt, null);
  assert.equal(faith.correctStreak, 0);
  assert.equal(faith.gapPlanId, undefined);
  assert.equal(body.conceptMastery["l1-law"]?.easiness, 2.1);
  assert.equal(body.conceptMastery["l1-law"]?.dueAt, 50);

  const progress = harness.saved.project?.learnProgress;
  assert.equal(progress?.v, 3);
  assert.equal(progress?.lessonReadDone.l1, true);
  assert.equal(progress?.lessonQuiz.l1?.answers[0]?.mcChoice, "Faith");
  assert.equal(progress?.lessonQuiz.l1?.answers[1]?.correct, false);
  assert.equal(progress?.lessonQuiz.l2?.answers[0]?.mcChoice, "x");
  assert.equal(harness.saved.attempt?.answers.length, 2);
  assert.equal(harness.saved.project?.updatedAt, 1_700_000_000_000);
});

test("a review attempt stores answers without replacing the lesson quiz", async () => {
  const harness = deps({
    readBody: async () => ({ target: "review", lessonId: "l1", answers: [answer({ correct: false })] }),
    loadProject: async () =>
      projectWith({
        v: 3,
        lessonQuiz: { l1: { answers: [{ mcChoice: "kept", shortText: "", shortSubmitted: false, correct: true }] } },
        conceptMastery: {},
      }),
  });
  const res = await handleLearnAttempt(harness.input);
  assert.equal(res.status, 200);
  assert.equal(harness.saved.project?.learnProgress?.lessonQuiz.l1?.answers[0]?.mcChoice, "kept");
  assert.equal(harness.saved.attempt?.target, "review");
  assert.equal(harness.saved.attempt?.answers[0]?.conceptId, "l1-faith");
  assert.ok(harness.saved.attempt?.conceptMastery["l1-faith"]);
});

test("an unknown lesson and a missing workspace project do not write the wrong record", async () => {
  const unknown = deps({
    loadProject: async () => projectWith(undefined, ["l1"]),
    readBody: async () => ({ target: "lesson", lessonId: "missing", answers: [answer()] }),
  });
  const rejected = await handleLearnAttempt(unknown.input);
  assert.equal(rejected.status, 400);
  assert.equal(unknown.saved.project, undefined);

  let savedProject = false;
  const unlinked = deps({
    loadProject: async () => null,
    saveProject: async () => {
      savedProject = true;
    },
  });
  const res = await handleLearnAttempt(unlinked.input);
  assert.equal(res.status, 200);
  assert.equal(savedProject, false);
  assert.equal(unlinked.saved.attempt?.conceptMastery["l1-faith"]?.lessonId, "l1");
});

test("applyLearnAttempt does not schedule a concept that was only just initialized", () => {
  const next = applyLearnAttempt(
    { v: 2, lessonReadDone: { l1: true } },
    { target: "final", answers: [answer({ conceptId: "final-hope", conceptLabel: "Hope" })] },
  );
  assert.equal(next.finalQuiz?.answers[0]?.correct, true);
  assert.equal(next.lessonReadDone.l1, true);
  assert.equal(next.conceptMastery["final-hope"]?.lessonId, "final");
  assert.equal(next.conceptMastery["final-hope"]?.dueAt, 0);
  assert.equal(next.conceptMastery["final-hope"]?.easiness, 2.5);
});

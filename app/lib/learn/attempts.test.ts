import assert from "node:assert/strict";
import test from "node:test";
import {
  attemptLessonError,
  mergeConceptMastery,
  mergeMasterySnapshots,
  mergeQuizByIndex,
  mirrorAttemptOntoProgress,
  parseLearnAttempt,
  type LearnAttemptAnswer,
} from "./attempts.ts";
import { newConceptMastery, type ConceptMastery, type LearnPlanProgress } from "./plan-progress.ts";
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

function scheduledFaith(): ConceptMastery {
  return {
    ...newConceptMastery({ conceptId: "l1-faith", conceptLabel: "Faith", lessonId: "l1" }),
    easiness: 2.1,
    repetitions: 3,
    dueAt: 9999,
    masteryRev: 1,
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
    learnPlan: { id: "plan-1", lessons: lessonIds.map((id) => ({ id })) },
    ...(progress !== undefined ? { learnProgress: progress } : {}),
  } as unknown as Project;
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
      previewAttempt: async () => {
        called = true;
        return { ok: true };
      },
      recordPlanAttempt: async () => {
        called = true;
        return {};
      },
      mirrorAttempt: async () => {
        called = true;
        return { ok: true };
      },
    });
    assert.equal(res.status, status);
    assert.equal(called, false);
  }
});

test("invalid attempt bodies are rejected before storage", async () => {
  let called = false;
  const res = await handleLearnAttempt({
    owned: { userId: "user_1" },
    readBody: async () => ({ target: "quiz" }),
    previewAttempt: async () => {
      called = true;
      return { ok: true };
    },
    recordPlanAttempt: async () => {
      called = true;
      return {};
    },
    mirrorAttempt: async () => {
      called = true;
      return { ok: true };
    },
  });
  assert.equal(res.status, 400);
  assert.equal(called, false);
  const parsed = parseLearnAttempt({
    target: "lesson",
    lessonId: "l1",
    answers: [{ conceptId: "not a slug", mcChoice: null, shortText: "", shortSubmitted: false, correct: null }],
  });
  assert.equal(parsed.ok, false);
});

test("a shorter lesson submission keeps the stored quiz tail", () => {
  const merged = mergeQuizByIndex(
    {
      answers: [
        { mcChoice: "first", shortText: "", shortSubmitted: false, correct: true },
        { mcChoice: "tail", shortText: "", shortSubmitted: false, correct: false },
      ],
    },
    [answer()],
  );
  assert.equal(merged.answers[0]?.mcChoice, "Faith");
  assert.equal(merged.answers[1]?.mcChoice, "tail");
});

test("plan scheduling fields win and overlapping concepts are kept", () => {
  const faith = scheduledFaith();
  const withLaw = mergeConceptMastery(
    { "l1-faith": faith },
    { target: "lesson", lessonId: "l1", answers: [answer({ conceptId: "l1-law", conceptLabel: "Law" })] },
  );
  const withHope = mergeConceptMastery(withLaw, {
    target: "final",
    answers: [answer({ conceptId: "final-hope", conceptLabel: "Hope" })],
  });
  assert.equal(withHope["l1-faith"]?.easiness, 2.1);
  assert.equal(withHope["l1-faith"]?.repetitions, 3);
  assert.equal(withHope["l1-faith"]?.dueAt, 9999);
  assert.equal(withHope["l1-law"]?.easiness, 2.5);
  assert.equal(withHope["l1-law"]?.repetitions, 0);
  assert.equal(withHope["final-hope"]?.lessonId, "final");
  const again = mergeConceptMastery(withHope, {
    target: "lesson",
    lessonId: "l1",
    answers: [answer()],
  });
  assert.equal(again["l1-faith"]?.easiness, 2.1);
  assert.equal(again["l1-law"]?.conceptId, "l1-law");
});

test("an older mastery snapshot cannot drop a concept or roll a revision back", () => {
  const faith = scheduledFaith();
  const law = { ...newConceptMastery({ conceptId: "l1-law", conceptLabel: "Law", lessonId: "l1" }), masteryRev: 3 };
  const hope = {
    ...newConceptMastery({ conceptId: "final-hope", conceptLabel: "Hope", lessonId: "final" }),
    masteryRev: 2,
  };
  const current = mergeMasterySnapshots({}, { "l1-faith": { ...faith, masteryRev: 4 }, "l1-law": law, "final-hope": hope });
  const next = mergeMasterySnapshots(current, {
    "l1-faith": { ...faith, easiness: 2.5, repetitions: 0, dueAt: 0, masteryRev: 1 },
    "final-hope": hope,
  });
  assert.equal(next["l1-law"]?.conceptId, "l1-law");
  assert.equal(next["final-hope"]?.lessonId, "final");
  assert.equal(next["l1-faith"]?.easiness, 2.1);
  assert.equal(next["l1-faith"]?.masteryRev, 4);
});

test("a final-quiz concept can be reviewed and an unknown lesson cannot", () => {
  const project = projectWith({ v: 3 });
  assert.equal(attemptLessonError(project, { target: "review", lessonId: "final", answers: [answer()] }), null);
  assert.equal(attemptLessonError(project, { target: "final", answers: [answer()] }), null);
  assert.equal(attemptLessonError(project, { target: "lesson", lessonId: "final", answers: [answer()] }), "Unknown lesson.");
  assert.equal(attemptLessonError(project, { target: "review", lessonId: "missing", answers: [answer()] }), "Unknown lesson.");
});

test("the handler returns plan mastery and a review of final does not 400", async () => {
  const project = projectWith({
    v: 3,
    lessonQuiz: {
      l1: {
        answers: [
          { mcChoice: "kept", shortText: "", shortSubmitted: false, correct: true },
          { mcChoice: "tail", shortText: "", shortSubmitted: false, correct: false },
        ],
      },
    },
    conceptMastery: {
      "l1-faith": newConceptMastery({ conceptId: "l1-faith", conceptLabel: "Faith", lessonId: "l1" }),
    },
  });
  let recorded = 0;
  const planMastery = { "l1-faith": scheduledFaith() };
  const res = await handleLearnAttempt({
    owned: { userId: "user_1" },
    readBody: async () => ({ target: "lesson", lessonId: "l1", answers: [answer()] }),
    previewAttempt: async (attempt) => {
      const error = attemptLessonError(project, attempt);
      return error ? { ok: false, error } : { ok: true };
    },
    recordPlanAttempt: async () => {
      recorded += 1;
      return planMastery;
    },
    mirrorAttempt: async (input) => {
      project.learnProgress = mirrorAttemptOntoProgress(project.learnProgress, input.attempt, input.conceptMastery);
      return { ok: true };
    },
    now: 1_700_000_000_000,
  });
  assert.equal(res.status, 200);
  assert.equal(recorded, 1);
  const body = (await res.json()) as { conceptMastery: LearnPlanProgress["conceptMastery"] };
  assert.equal(body.conceptMastery["l1-faith"]?.easiness, 2.1);
  assert.equal(body.conceptMastery["l1-faith"]?.repetitions, 3);
  assert.equal(body.conceptMastery["l1-faith"]?.dueAt, 9999);
  assert.equal(project.learnProgress?.lessonQuiz.l1?.answers[0]?.mcChoice, "Faith");
  assert.equal(project.learnProgress?.lessonQuiz.l1?.answers[1]?.mcChoice, "tail");
  assert.equal(project.learnProgress?.conceptMastery["l1-faith"]?.easiness, 2.1);

  const review = await handleLearnAttempt({
    owned: { userId: "user_1" },
    readBody: async () => ({
      target: "review",
      lessonId: "final",
      answers: [answer({ conceptId: "final-hope", conceptLabel: "Hope" })],
    }),
    previewAttempt: async (attempt) => {
      const error = attemptLessonError(project, attempt);
      return error ? { ok: false, error } : { ok: true };
    },
    recordPlanAttempt: async () => ({
      ...planMastery,
      "final-hope": newConceptMastery({ conceptId: "final-hope", conceptLabel: "Hope", lessonId: "final" }),
    }),
    mirrorAttempt: async (input) => {
      project.learnProgress = mirrorAttemptOntoProgress(project.learnProgress, input.attempt, input.conceptMastery);
      return { ok: true };
    },
  });
  assert.equal(review.status, 200);
  assert.equal(project.learnProgress?.lessonQuiz.l1?.answers[0]?.mcChoice, "Faith");
  assert.equal(project.learnProgress?.conceptMastery["final-hope"]?.lessonId, "final");
});

test("an unknown lesson does not record and a missing project still stores the attempt", async () => {
  let recorded = false;
  const unknown = await handleLearnAttempt({
    owned: { userId: "user_1" },
    readBody: async () => ({ target: "lesson", lessonId: "missing", answers: [answer()] }),
    previewAttempt: async (attempt) => {
      const error = attemptLessonError(projectWith(undefined, ["l1"]), attempt);
      return error ? { ok: false, error } : { ok: true };
    },
    recordPlanAttempt: async () => {
      recorded = true;
      return {};
    },
    mirrorAttempt: async () => ({ ok: true }),
  });
  assert.equal(unknown.status, 400);
  assert.equal(recorded, false);

  const unlinked = await handleLearnAttempt({
    owned: { userId: "user_1" },
    readBody: async () => ({ target: "lesson", lessonId: "l1", answers: [answer()] }),
    previewAttempt: async () => ({ ok: true }),
    recordPlanAttempt: async () => ({
      "l1-faith": newConceptMastery({ conceptId: "l1-faith", conceptLabel: "Faith", lessonId: "l1" }),
    }),
    mirrorAttempt: async () => ({ ok: true }),
  });
  assert.equal(unlinked.status, 200);
});

import assert from "node:assert/strict";
import test from "node:test";
import { awardLearning, emptyStats, lessonMasteryPercent, statsFigures, ymdInTimeZone } from "./learner-stats.ts";
import { emptyLearnProgress, normalizeLearnProgress, type LearnPlanProgress } from "./plan-progress.ts";
import { adoptProgressForScope } from "./progress-scope.ts";
import { parseLearnerStatsPut } from "../server/user-workspace-schema.ts";

test("awarding XP once per reason advances the streak on a new local day", () => {
  const zone = "UTC";
  const monday = Date.parse("2026-11-16T15:00:00Z");
  assert.equal(ymdInTimeZone(monday, zone), "2026-11-16");
  const first = awardLearning(emptyStats(), { reason: "read:p:l1", amount: 15 }, monday, zone);
  assert.equal(first.xp, 15);
  assert.equal(first.streak, 1);
  assert.equal(first.last_goal_date, "2026-11-16");
  const same = awardLearning(first, { reason: "read:p:l1", amount: 15 }, monday + 1000, zone);
  assert.equal(same, first);
  const tuesday = awardLearning(first, { reason: "quiz:p:l1:0:correct", amount: 10 }, Date.parse("2026-11-17T01:00:00Z"), zone);
  assert.equal(tuesday.xp, 25);
  assert.equal(tuesday.streak, 2);
  const later = awardLearning(tuesday, { reason: "read:p:l2", amount: 15 }, Date.parse("2026-11-20T01:00:00Z"), zone);
  assert.equal(later.streak, 1);
  assert.equal(later.xp, 40);
});

test("lesson mastery moves when a lesson is read and when a quiz answer is credited", () => {
  const scope = { projectId: "path-ruth", planId: "plan-ruth" };
  const unread = emptyLearnProgress();
  assert.equal(lessonMasteryPercent({ scope, lessonId: "l1", quizCount: 2, progress: unread }), 0);
  const read = adoptProgressForScope(
    normalizeLearnProgress({
      v: 3,
      lessonReadScroll: { l1: 100 },
      lessonReadDone: { l1: true },
    }),
    scope,
  );
  const readOnly = lessonMasteryPercent({ scope, lessonId: "l1", quizCount: 2, progress: read });
  assert.ok(readOnly > 0 && readOnly < 100);
  const answered: LearnPlanProgress = adoptProgressForScope(
    normalizeLearnProgress({
      ...read,
      lessonQuiz: {
        l1: {
          answers: [
            { mcChoice: "A", shortText: "", shortSubmitted: false, correct: true },
            { mcChoice: null, shortText: "loyalty", shortSubmitted: true, correct: false, score: 0.5 },
          ],
        },
      },
    }),
    scope,
  );
  const afterQuiz = lessonMasteryPercent({ scope, lessonId: "l1", quizCount: 2, progress: answered });
  assert.ok(afterQuiz > readOnly);
  assert.equal(
    lessonMasteryPercent({
      scope: { projectId: "path-jonah", planId: "plan-jonah" },
      lessonId: "l1",
      quizCount: 2,
      progress: answered,
    }),
    0,
  );
});

test("stats figures stay blank until a snapshot has loaded", () => {
  assert.deepEqual(statsFigures(null), { xp: "…", streak: "…", busy: true });
  assert.equal(statsFigures(null).xp === "0", false);
  assert.deepEqual(statsFigures({ xp: 15, streak: 2 }), { xp: "15", streak: "2", busy: false });
});

test("a plan-scoped award does not pay again for the same lesson reason", () => {
  const first = awardLearning(emptyStats(), { reason: "read:path-ruth:l1", amount: 15 }, Date.parse("2026-11-16T15:00:00Z"), "UTC");
  const again = awardLearning(first, { reason: "read:path-ruth:plan-ruth:l1", amount: 15 }, Date.parse("2026-11-16T16:00:00Z"), "UTC");
  assert.equal(again, first);
});

test("the real client stats payload, with uuid path ids, passes validation", () => {
  const projectId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const planId = "11111111-2222-4333-8444-555555555555";
  const now = Date.parse("2026-11-23T15:00:00Z");
  const readReason = `read:${projectId}:${planId}:l1`;
  const quizReason = `quiz:${projectId}:${planId}:l1:0:correct`;
  assert.ok(readReason.length > 80);
  assert.ok(quizReason.length > 80);

  const read = awardLearning(emptyStats(), { reason: readReason, amount: 15 }, now, "America/Los_Angeles");
  const again = awardLearning(read, { reason: readReason, amount: 15 }, now + 1_000, "America/Los_Angeles");
  assert.equal(again, read);
  const quiz = awardLearning(read, { reason: quizReason, amount: 10 }, now + 2_000, "America/Los_Angeles");
  const otherLesson = awardLearning(
    quiz,
    { reason: `read:${projectId}:${planId}:l2`, amount: 15 },
    now + 3_000,
    "America/Los_Angeles",
  );
  assert.equal(otherLesson.xp, 40);
  assert.equal(otherLesson.payload.xpLog.length, 3);
  const reasons = otherLesson.payload.xpLog.map((entry) => entry.reason);
  assert.equal(new Set(reasons).size, 3);
  for (const reason of reasons) {
    assert.ok(reason.length <= 80);
    assert.equal(reason.includes(projectId), false);
  }

  const parsed = parseLearnerStatsPut(otherLesson);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.patch.xp, 40);
    assert.equal(parsed.patch.timezone, "America/Los_Angeles");
    assert.deepEqual(parsed.patch.payload?.dailyGoalMet, otherLesson.payload.dailyGoalMet);
    assert.deepEqual(parsed.patch.payload?.xpLog, otherLesson.payload.xpLog);
  }

  const rejected = parseLearnerStatsPut({
    ...otherLesson,
    payload: {
      ...otherLesson.payload,
      xpLog: [{ at: now, amount: 15, reason: readReason }],
    },
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /payload\.xpLog reason must be a short string/);

  const legacy = awardLearning(emptyStats(), { reason: `read:${projectId}:l1`, amount: 15 }, now, "UTC");
  assert.equal(legacy.payload.xpLog[0]?.reason, `read:${projectId}:l1`);
  const scoped = awardLearning(legacy, { reason: readReason, amount: 15 }, now + 1_000, "UTC");
  assert.equal(scoped, legacy);
});

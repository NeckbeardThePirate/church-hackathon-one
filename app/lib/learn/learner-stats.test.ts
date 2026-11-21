import assert from "node:assert/strict";
import test from "node:test";
import { awardLearning, emptyStats, lessonMasteryPercent, statsFigures, ymdInTimeZone } from "./learner-stats.ts";
import { emptyLearnProgress, normalizeLearnProgress, type LearnPlanProgress } from "./plan-progress.ts";
import { adoptProgressForScope } from "./progress-scope.ts";

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

import assert from "node:assert/strict";
import test from "node:test";
import {
  DAILY_GOAL_XP,
  XP_AMOUNTS,
  XP_DAILY_GOAL,
  XP_REVIEWS,
  XP_STREAK_CAP,
  XP_STREAK_PER_DAY,
  applyXpAwards,
  dailyGoalStatus,
  emptyStats,
  lessonMasteryPercent,
  parseXpAwardRequest,
  statsFigures,
  xpReason,
  ymdInTimeZone,
  type StatsSnapshot,
  type XpEvent,
} from "./learner-stats.ts";
import { emptyLearnProgress, normalizeLearnProgress, type LearnPlanProgress } from "./plan-progress.ts";
import { adoptProgressForScope } from "./progress-scope.ts";

const zone = "America/Los_Angeles";

function award(current: StatsSnapshot, events: XpEvent[], now: number, timeZone: string | null = zone) {
  return applyXpAwards(current, events, now, timeZone);
}

test("spec amounts are the ones the server pays", () => {
  assert.equal(XP_AMOUNTS.read, 10);
  assert.equal(XP_AMOUNTS.first, 5);
  assert.equal(XP_AMOUNTS.quiz, 20);
  assert.equal(XP_AMOUNTS.gap, 40);
  assert.equal(XP_AMOUNTS.final, 25);
  assert.equal(XP_AMOUNTS.reviews, 15);
  assert.equal(XP_DAILY_GOAL, 10);
  assert.equal(XP_STREAK_PER_DAY, 5);
  assert.equal(XP_STREAK_CAP, 50);
  assert.equal(DAILY_GOAL_XP, 30);
});

test("awards pay the spec amount once, and the streak follows the stored timezone", () => {
  const lateNight = Date.parse("2026-11-17T07:30:00Z");
  assert.equal(ymdInTimeZone(lateNight, zone), "2026-11-16");
  const first = award(emptyStats(), [{ kind: "read", reason: "read:p:plan:l1" }], lateNight);
  assert.equal(first.error, undefined);
  assert.equal(first.stats.xp, 10);
  assert.equal(first.stats.streak, 0);
  assert.equal(first.stats.timezone, zone);
  assert.equal(first.stats.last_goal_date, null);
  assert.equal(first.stats.payload.todayXp, 10);
  assert.equal(dailyGoalStatus(first.stats, lateNight).earned, 10);
  assert.equal(dailyGoalStatus(first.stats, lateNight).met, false);

  const same = award(first.stats, [{ kind: "read", reason: "read:p:plan:l1" }], lateNight + 1000, "UTC");
  assert.equal(same.stats, first.stats);
  assert.equal(same.accepted.length, 0);

  const morning = Date.parse("2026-11-17T16:00:00Z");
  assert.equal(ymdInTimeZone(morning, zone), "2026-11-17");
  const next = award(first.stats, [{ kind: "quiz", reason: "quiz:p:plan:l1" }], morning, "UTC");
  assert.equal(next.stats.timezone, zone);
  assert.equal(next.stats.streak, 0);
  assert.equal(next.stats.last_goal_date, null);
  assert.equal(next.stats.xp, 30);
  assert.equal(next.stats.payload.todayXp, 20);
  assert.equal(next.stats.payload.dailyGoalMet.includes("2026-11-17"), false);

  const goal = award(next.stats, [{ kind: "read", reason: "read:p:plan:l2" }], morning + 1000, "Europe/London");
  assert.equal(goal.stats.timezone, zone);
  assert.equal(goal.stats.streak, 1);
  assert.equal(goal.stats.last_goal_date, "2026-11-17");
  assert.equal(goal.stats.xp, 30 + 10 + XP_DAILY_GOAL + XP_STREAK_PER_DAY);
  assert.equal(goal.stats.payload.dailyGoalMet.includes("2026-11-17"), true);
  assert.equal(dailyGoalStatus(goal.stats, morning).met, true);
  assert.equal(dailyGoalStatus(goal.stats, morning).earned, 30);
  const again = award(goal.stats, [{ kind: "read", reason: "read:p:plan:l2" }], morning + 2000);
  assert.equal(again.stats.xp, goal.stats.xp);
});

test("a read below the daily goal on a new local day does not extend the streak", () => {
  const monday = Date.parse("2026-11-16T20:00:00Z");
  const met = award(
    emptyStats(),
    [
      { kind: "read", reason: "read:p:l1" },
      { kind: "quiz", reason: "quiz:p:l1" },
    ],
    monday,
  );
  assert.equal(met.stats.streak, 1);
  assert.equal(met.stats.last_goal_date, "2026-11-16");
  assert.equal(met.stats.payload.todayXp, 30);

  const tuesday = Date.parse("2026-11-17T20:00:00Z");
  const read = award(met.stats, [{ kind: "read", reason: "read:p:l2" }], tuesday);
  assert.equal(read.stats.xp, met.stats.xp + 10);
  assert.equal(read.stats.payload.todayXp, 10);
  assert.equal(read.stats.streak, 1);
  assert.equal(read.stats.last_goal_date, "2026-11-16");
  assert.equal(
    read.accepted.some((entry) => entry.kind === "goal" || entry.kind === "streak"),
    false,
  );

  const done = award(read.stats, [{ kind: "quiz", reason: "quiz:p:l2" }], tuesday + 1000);
  assert.equal(done.stats.payload.todayXp, 30);
  assert.equal(done.stats.streak, 2);
  assert.equal(done.stats.last_goal_date, "2026-11-17");
});

test("a client amount cannot change what an event pays", () => {
  const parsed = parseXpAwardRequest({
    timezone: zone,
    events: [{ kind: "read", reason: "read:p:l1", amount: 999 }],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal("amount" in parsed.events[0]!, false);
  const paid = applyXpAwards(emptyStats(), parsed.events, Date.parse("2026-11-16T20:00:00Z"), parsed.timezone);
  assert.equal(paid.stats.xp, 10);
});

test("streak bonus is 5 per streak day and stops at 50", () => {
  let stats = emptyStats();
  let xpBeforeBonus = 0;
  for (let day = 0; day < 12; day++) {
    const now = Date.parse("2026-11-16T20:00:00Z") + day * 86_400_000;
    const events: XpEvent[] = [
      { kind: "read", reason: `read:p:d${day}` },
      { kind: "quiz", reason: `quiz:p:d${day}` },
    ];
    const next = award(stats, events, now);
    stats = next.stats;
    const bonus = next.accepted.find((entry) => entry.kind === "streak");
    assert.ok(bonus);
    assert.equal(bonus!.amount, Math.min((day + 1) * XP_STREAK_PER_DAY, XP_STREAK_CAP));
    if (day === 11) {
      assert.equal(bonus!.amount, 50);
      assert.equal(stats.streak, 12);
      assert.equal(stats.xp - xpBeforeBonus, 10 + 20 + XP_DAILY_GOAL + 50);
    }
    xpBeforeBonus = stats.xp;
  }
  const skipped = award(stats, [{ kind: "read", reason: "read:p:later" }], Date.parse("2026-11-16T20:00:00Z") + 20 * 86_400_000);
  assert.equal(skipped.stats.streak, 12);
  assert.equal(skipped.stats.last_goal_date, stats.last_goal_date);
  assert.equal(skipped.stats.payload.todayXp, 10);
  const resumed = award(
    skipped.stats,
    [
      { kind: "quiz", reason: "quiz:p:later" },
      { kind: "first", reason: "first:p:later" },
    ],
    Date.parse("2026-11-16T20:00:00Z") + 20 * 86_400_000 + 1000,
  );
  assert.equal(resumed.stats.streak, 1);
  assert.equal(resumed.stats.payload.todayXp, 35);
});

test("a trimmed xp log still blocks the same lesson", () => {
  let stats = emptyStats();
  const now = Date.parse("2026-11-16T20:00:00Z");
  const first = award(stats, [{ kind: "read", reason: "read:p:l0" }], now);
  stats = first.stats;
  for (let i = 1; i <= 120; i++) {
    stats = award(stats, [{ kind: "first", reason: `first:p:q:${i}` }], now + i).stats;
  }
  assert.ok(stats.payload.xpLog.length <= 100);
  assert.equal(stats.payload.awarded.includes("read:p:l0"), true);
  const before = stats.xp;
  const again = award(stats, [{ kind: "read", reason: "read:p:l0" }], now + 10_000);
  assert.equal(again.stats.xp, before);
});

test("a plan-scoped read does not pay again for the same lesson", () => {
  const now = Date.parse("2026-11-16T20:00:00Z");
  const first = award(emptyStats(), [{ kind: "read", reason: "read:path-ruth:l1" }], now);
  const again = award(first.stats, [{ kind: "read", reason: "read:path-ruth:plan-ruth:l1" }], now + 1000);
  assert.equal(again.stats, first.stats);
});

test("a long review session key stays unique after it is shortened", () => {
  const stampA = `${"concept-mercy".repeat(4)}:111`;
  const stampB = `${"concept-mercy".repeat(4)}:222`;
  const first = xpReason("reviews", ["path-ruth", "plan-ruth", stampA]);
  const second = xpReason("reviews", ["path-ruth", "plan-ruth", stampB]);
  assert.notEqual(first, second);
  assert.ok(first.length <= 80);
  assert.ok(second.length <= 80);
  const now = Date.parse("2026-11-23T20:00:00Z");
  const paid = award(emptyStats(), [{ kind: "reviews", reason: first }], now);
  const again = award(paid.stats, [{ kind: "reviews", reason: second }], now + 1000);
  const reviews = again.accepted.filter((entry) => entry.kind === "reviews");
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]!.amount, XP_REVIEWS);
  assert.equal(again.stats.xp, paid.stats.xp + XP_REVIEWS + XP_DAILY_GOAL + XP_STREAK_PER_DAY);
});

test("uuid award keys stay short and still match the older compact code", () => {
  const projectId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const planId = "11111111-2222-4333-8444-555555555555";
  const now = Date.parse("2026-11-23T20:00:00Z");
  const reason = xpReason("read", [projectId, planId, "l1"]);
  assert.ok(reason.length <= 80);
  assert.equal(reason.includes(projectId), false);
  const legacy = {
    ...emptyStats(),
    xp: 15,
    timezone: zone,
    payload: {
      ...emptyStats().payload,
      xpLog: [{ at: now, amount: 15, reason: "r:aaaaaaaa:11111111:l1" }],
      awarded: ["r:aaaaaaaa:11111111:l1"],
    },
  };
  const again = award(legacy, [{ kind: "read", reason }], now + 1000);
  assert.equal(again.stats, legacy);
  const other = award(legacy, [{ kind: "read", reason: xpReason("read", [projectId, planId, "l2"]) }], now + 2000);
  assert.equal(other.stats.xp, 25);
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

test("an award without a timezone is refused", () => {
  const result = applyXpAwards(emptyStats(), [{ kind: "gap", reason: "gap:p:g1" }], Date.parse("2026-11-16T20:00:00Z"), null);
  assert.equal(result.stats.xp, 0);
  assert.match(result.error ?? "", /time zone/i);
  const bad = parseXpAwardRequest({ timezone: "Not/AZone", events: [{ kind: "gap", reason: "gap:p:g1" }] });
  assert.equal(bad.ok, false);
});

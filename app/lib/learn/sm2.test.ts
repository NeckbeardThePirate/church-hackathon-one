import assert from "node:assert/strict";
import test from "node:test";
import { newConceptMastery, type ConceptMastery } from "./plan-progress.ts";
import type { QuizItem } from "./types.ts";
import {
  applyAttemptSchedule,
  conceptItemBank,
  dueAtForInterval,
  dueConcepts,
  isConceptDue,
  localDayStart,
  nextEase,
  nextIntervalDays,
  pickReviewItem,
  reviewQuality,
  reviewQueue,
  scheduleConcept,
  SM2_MIN_EASE,
} from "./sm2.ts";

const NOW = Date.parse("2026-11-16T15:00:00Z");
const ZONE = "America/Los_Angeles";

function fresh(over: Partial<ConceptMastery> = {}): ConceptMastery {
  return {
    ...newConceptMastery({ conceptId: "l1-faith", conceptLabel: "Faith", lessonId: "l1" }),
    ...over,
  };
}

function item(over: Partial<QuizItem> = {}): QuizItem {
  return {
    kind: "mc",
    question: "What is faith?",
    choices: ["Trust", "Fear"],
    answer: "Trust",
    rationale: "Faith is trust.",
    objectiveIndex: 0,
    conceptId: "l1-faith",
    conceptLabel: "Faith",
    ...over,
  };
}

test("quality is first-try 5, later correct 4, incorrect 2, and skipped or blank 0", () => {
  assert.equal(reviewQuality({ correct: true, firstTry: true }), 5);
  assert.equal(reviewQuality({ correct: true }), 5);
  assert.equal(reviewQuality({ correct: true, firstTry: false }), 4);
  assert.equal(reviewQuality({ correct: true, previousQuality: 2 }), 4);
  assert.equal(reviewQuality({ correct: false }), 2);
  assert.equal(reviewQuality({ correct: null, skipped: true }), 0);
  assert.equal(reviewQuality({ correct: null, blank: true }), 0);
  assert.equal(reviewQuality({ correct: null }), 0);
});

test("ease follows SM-2 and never drops below 1.3", () => {
  assert.equal(nextEase(2.5, 5), 2.6);
  assert.equal(nextEase(2.5, 4), 2.5);
  assert.equal(nextEase(2.5, 2), 2.18);
  assert.equal(nextEase(2.5, 0), 1.7);
  assert.equal(nextEase(1.3, 0), SM2_MIN_EASE);
  assert.equal(nextEase(1.4, 0), SM2_MIN_EASE);
});

test("intervals are 1 day, then 3 days, then round(previous × ease)", () => {
  assert.equal(nextIntervalDays(1, 0, 2.6), 1);
  assert.equal(nextIntervalDays(2, 1, 2.6), 3);
  assert.equal(nextIntervalDays(3, 3, 2.6), 8);
  assert.equal(nextIntervalDays(4, 0, 2.2), 1);
});

test("a miss is due now and still updates ease", () => {
  const missed = scheduleConcept(fresh(), 2, NOW, ZONE);
  assert.equal(missed.repetitions, 0);
  assert.equal(missed.intervalDays, 0);
  assert.equal(missed.dueAt, NOW);
  assert.equal(missed.easiness, 2.18);
  assert.equal(missed.lastQuality, 2);
  assert.equal(missed.correctStreak, 0);
  assert.equal(isConceptDue(missed, NOW), true);

  const skipped = scheduleConcept(fresh({ easiness: 2.6, repetitions: 2, intervalDays: 3, dueAt: NOW - 1000 }), 0, NOW, ZONE);
  assert.equal(skipped.dueAt, NOW);
  assert.equal(skipped.repetitions, 0);
  assert.equal(skipped.intervalDays, 0);
  assert.equal(skipped.easiness, nextEase(2.6, 0));
  assert.ok(skipped.easiness >= SM2_MIN_EASE);
});

test("a correct first review of a new concept is due at the next local midnight", () => {
  const passed = scheduleConcept(fresh(), 5, NOW, ZONE);
  assert.equal(passed.repetitions, 1);
  assert.equal(passed.intervalDays, 1);
  assert.equal(passed.easiness, 2.6);
  assert.equal(passed.dueAt, dueAtForInterval(1, NOW, ZONE));
  assert.equal(passed.dueAt, localDayStart("2026-11-17", ZONE));
  assert.ok(passed.dueAt > NOW);
  assert.equal(isConceptDue(passed, NOW), false);
  assert.equal(ymdHour(passed.dueAt, ZONE), "2026-11-17 00");
});

test("the second and third passes use 3 days and then the ease product, at local midnight", () => {
  const first = scheduleConcept(fresh(), 5, NOW, ZONE);
  const second = scheduleConcept(first, 5, first.dueAt + 60_000, ZONE);
  assert.equal(second.repetitions, 2);
  assert.equal(second.intervalDays, 3);
  assert.equal(second.easiness, 2.7);
  assert.equal(second.dueAt, localDayStart("2026-11-20", ZONE));

  const third = scheduleConcept(second, 4, second.dueAt + 60_000, ZONE);
  assert.equal(third.repetitions, 3);
  assert.equal(third.intervalDays, Math.round(3 * 2.7));
  assert.equal(third.easiness, 2.7);
  assert.equal(ymdHour(third.dueAt, ZONE), "2026-11-28 00");
});

test("an unscheduled legacy row is not due, and the next success starts the 1-day ladder", () => {
  const legacy = fresh({ repetitions: 4, intervalDays: 0, dueAt: 0, lastQuality: 5, lastReviewedAt: NOW - 86_400_000 });
  assert.equal(isConceptDue(legacy, NOW), false);
  assert.equal(isConceptDue(fresh({ dueAt: 0 }), 0), false);
  const scheduled = scheduleConcept(legacy, 5, NOW, "UTC");
  assert.equal(scheduled.repetitions, 1);
  assert.equal(scheduled.intervalDays, 1);
  assert.equal(scheduled.dueAt, localDayStart("2026-11-17", "UTC"));
});

test("the queue lists concepts due now, most overdue first, and skips rows with no real item", () => {
  const older = fresh({ conceptId: "l1-law", conceptLabel: "Law", dueAt: NOW - 50_000, lastReviewedAt: NOW - 50_000 });
  const newer = fresh({ dueAt: NOW - 1000, lastReviewedAt: NOW - 1000 });
  const waiting = fresh({ conceptId: "l1-hope", conceptLabel: "Hope", dueAt: NOW + 86_400_000 });
  const unscheduled = fresh({ conceptId: "l1-grace", conceptLabel: "Grace", dueAt: 0 });
  const invented = fresh({ conceptId: "l1-made-up", conceptLabel: "Made up", dueAt: NOW - 999_999 });
  const mastery = {
    faith: newer,
    law: older,
    hope: waiting,
    grace: unscheduled,
    made: invented,
  };
  assert.deepEqual(
    dueConcepts(mastery, NOW).map((row) => row.conceptId),
    ["l1-made-up", "l1-law", "l1-faith"],
  );
  const alternate = item({
    question: "Which word is closest to faith?",
    alternate: undefined,
  });
  const plan = {
    lessons: [
      {
        id: "l1",
        quiz: [
          item({ alternate }),
          item({ question: "What is law?", conceptId: "l1-law", conceptLabel: "Law", choices: ["Rule", "Grace"], answer: "Rule" }),
        ],
      },
    ],
    finalAssessment: [] as QuizItem[],
  };
  const queue = reviewQueue(plan, mastery, NOW);
  assert.deepEqual(
    queue.map((entry) => entry.concept.conceptId),
    ["l1-law", "l1-faith"],
  );
  assert.equal(queue[0]?.lessonId, "l1");
});

test("a review draws the unused sibling and falls back to the original", () => {
  const original = item();
  const alternate = item({ question: "Which word is closest to faith?" });
  const tagged = item({ alternate });
  const foreign = item({
    question: "Original only",
    conceptId: "l1-law",
    conceptLabel: "Law",
    alternate: item({ question: "Different concept", conceptId: "l1-other", conceptLabel: "Other" }),
  });
  const bank = conceptItemBank({
    lessons: [{ quiz: [tagged, foreign] }],
    finalAssessment: [item({ question: "Final faith?", conceptId: "l1-faith", conceptLabel: "Faith" })],
  });
  const faith = bank.get("l1-faith") ?? [];
  assert.deepEqual(
    faith.map((entry) => entry.question),
    ["What is faith?", "Which word is closest to faith?", "Final faith?"],
  );
  assert.equal(pickReviewItem(faith, null)?.question, "Which word is closest to faith?");
  assert.equal(pickReviewItem(faith, "Which word is closest to faith?")?.question, "What is faith?");
  assert.equal(pickReviewItem(faith, "What is faith?")?.question, "Which word is closest to faith?");
  const law = bank.get("l1-law") ?? [];
  assert.equal(law.length, 1);
  assert.equal(pickReviewItem(law, null)?.question, "Original only");
  assert.equal(pickReviewItem(law, "Original only")?.question, "Original only");
  assert.equal(bank.has("l1-other"), false);
  assert.equal(original.question, faith[0]?.question);
});

test("a submitted miss is due now and a submitted success is due the next local day", () => {
  const attempt = {
    target: "review" as const,
    lessonId: "l1",
    answers: [
      {
        conceptId: "l1-faith",
        conceptLabel: "Faith",
        mcChoice: "Fear",
        shortText: "",
        shortSubmitted: false,
        correct: false,
        firstTry: true,
        previousReviewedAt: null,
      },
    ],
  };
  const missed = applyAttemptSchedule({}, attempt, NOW, ZONE);
  assert.equal(missed["l1-faith"]?.dueAt, NOW);
  assert.equal(missed["l1-faith"]?.repetitions, 0);
  assert.equal(missed["l1-faith"]?.masteryRev, 1);

  const passed = applyAttemptSchedule(missed, {
    ...attempt,
    answers: [{ ...attempt.answers[0]!, correct: true, firstTry: false, previousReviewedAt: NOW }],
  }, NOW + 1000, ZONE);
  assert.equal(passed["l1-faith"]?.repetitions, 1);
  assert.equal(passed["l1-faith"]?.intervalDays, 1);
  assert.equal(passed["l1-faith"]?.dueAt, localDayStart("2026-11-17", ZONE));
  assert.equal(passed["l1-law"], undefined);
});

test("scheduling leaves concepts that were not in the attempt, and does not apply twice", () => {
  const law = fresh({ conceptId: "l1-law", conceptLabel: "Law", easiness: 2.1, repetitions: 3, intervalDays: 8, dueAt: 9999, masteryRev: 2 });
  const faith = fresh({ dueAt: 0 });
  const next = applyAttemptSchedule(
    { "l1-law": law, "l1-faith": faith },
    {
      target: "lesson",
      lessonId: "l1",
      answers: [
        {
          conceptId: "l1-faith",
          conceptLabel: "Faith",
          mcChoice: "Trust",
          shortText: "",
          shortSubmitted: false,
          correct: true,
          applySchedule: false,
        },
        {
          conceptId: "l1-hope",
          conceptLabel: "Hope",
          mcChoice: null,
          shortText: "",
          shortSubmitted: false,
          correct: null,
        },
      ],
    },
    NOW,
    "UTC",
  );
  assert.equal(next["l1-law"]?.dueAt, 9999);
  assert.equal(next["l1-law"]?.easiness, 2.1);
  assert.equal(next["l1-faith"]?.dueAt, 0);
  assert.equal(next["l1-hope"]?.dueAt, NOW);
  assert.equal(next["l1-hope"]?.lastQuality, 0);

  const optimistic = scheduleConcept(faith, 5, NOW, "UTC");
  const kept = applyAttemptSchedule(
    { "l1-faith": { ...optimistic, masteryRev: 4 } },
    {
      target: "review",
      lessonId: "l1",
      answers: [
        {
          conceptId: "l1-faith",
          conceptLabel: "Faith",
          mcChoice: "Trust",
          shortText: "",
          shortSubmitted: false,
          correct: true,
          firstTry: true,
          previousReviewedAt: null,
        },
      ],
    },
    NOW + 5000,
    "UTC",
  );
  assert.equal(kept["l1-faith"]?.dueAt, optimistic.dueAt);
  assert.equal(kept["l1-faith"]?.repetitions, 1);
  assert.equal(kept["l1-faith"]?.masteryRev, 5);
});

function ymdHour(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(new Date(instant));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}`;
}

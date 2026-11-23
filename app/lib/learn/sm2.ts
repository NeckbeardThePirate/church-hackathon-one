/**
 * SM-2 scheduling for one concept.
 * The plan Durable Object applies this on quiz and review submit (source of truth).
 * The client uses the same function for the offline queue and for sort order.
 * dueAt 0 is unscheduled and is not due.
 */

import type { LearnAttempt, LearnAttemptAnswer } from "./attempts.ts";
import { shiftYmd, ymdInTimeZone } from "./learner-stats.ts";
import { newConceptMastery, type ConceptMastery, type LearnPlanProgress } from "./plan-progress.ts";
import type { QuizItem } from "./types.ts";

export const SM2_MIN_EASE = 1.3;
export const SM2_DEFAULT_EASE = 2.5;

function isIanaTimeZone(value: string): boolean {
  if (!value || value.length > 100) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Grades this app assigns. The ease formula is the standard SM-2 formula. */
export type ReviewQuality = 0 | 2 | 4 | 5;

export function reviewQuality(input: {
  correct: boolean | null;
  skipped?: boolean;
  blank?: boolean;
  /** False after a miss in this sitting. Omitted: a prior failing grade counts as not first-try. */
  firstTry?: boolean;
  previousQuality?: number | null;
}): ReviewQuality {
  if (input.skipped || input.blank || input.correct == null) return 0;
  if (!input.correct) return 2;
  if (input.firstTry === false) return 4;
  if (input.firstTry === true) return 5;
  if (input.previousQuality != null && input.previousQuality < 3) return 4;
  return 5;
}

/** Standard SM-2 ease update. Result is never below 1.3. */
export function nextEase(ease: number, quality: number): number {
  const q = Math.min(5, Math.max(0, quality));
  const gap = 5 - q;
  const delta = 0.1 - gap * (0.08 + gap * 0.02);
  const next = Math.round((ease + delta) * 100) / 100;
  return next < SM2_MIN_EASE ? SM2_MIN_EASE : next;
}

/**
 * Next interval in days.
 * Passing grades: 1, then 3, then round(previous × ease). A pass is at least 1 day.
 */
export function nextIntervalDays(nextRepetitions: number, previousIntervalDays: number, ease: number): number {
  if (nextRepetitions <= 1) return 1;
  if (nextRepetitions === 2) return 3;
  if (previousIntervalDays <= 0) return 1;
  return Math.max(1, Math.round(previousIntervalDays * ease));
}

function zoneOrUtc(timeZone: string | null | undefined): string {
  return timeZone && isIanaTimeZone(timeZone) ? timeZone : "UTC";
}

function wallClockAsUtc(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const pick = (type: string) => {
    const value = Number(parts.find((part) => part.type === type)?.value);
    return Number.isFinite(value) ? value : 0;
  };
  let hour = pick("hour");
  if (hour === 24) hour = 0;
  return Date.UTC(pick("year"), pick("month") - 1, pick("day"), hour, pick("minute"), pick("second"));
}

/** UTC instant of 00:00 on ymd in the learner's zone. */
export function localDayStart(ymd: string, timeZone: string): number {
  const zone = zoneOrUtc(timeZone);
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  const utcGuess = Date.UTC(year!, (month ?? 1) - 1, day ?? 1);
  const offset = wallClockAsUtc(utcGuess, zone) - utcGuess;
  let midnight = utcGuess - offset;
  const offsetAtMidnight = wallClockAsUtc(midnight, zone) - midnight;
  if (offsetAtMidnight !== offset) midnight = utcGuess - offsetAtMidnight;
  if (ymdInTimeZone(midnight, zone) === ymd) return midnight;
  const direction = ymdInTimeZone(midnight, zone) < ymd ? 1 : -1;
  for (let step = 1; step <= 30; step++) {
    const candidate = midnight + direction * step * 60 * 1000;
    if (ymdInTimeZone(candidate, zone) !== ymd) continue;
    let start = candidate;
    while (ymdInTimeZone(start - 1000, zone) === ymd) start -= 1000;
    return start;
  }
  return midnight;
}

/** When the next review comes due. A day or more is the start of that local day. */
export function dueAtForInterval(intervalDays: number, now: number, timeZone: string): number {
  if (intervalDays <= 0) return now;
  const zone = zoneOrUtc(timeZone);
  return localDayStart(shiftYmd(ymdInTimeZone(now, zone), intervalDays), zone);
}

/**
 * One SM-2 step.
 * Below 3: repetitions and interval reset, due immediately, ease still moves.
 * A concept with dueAt 0 has never been scheduled, so the next pass starts the 1-day ladder.
 */
export function scheduleConcept(
  row: ConceptMastery,
  quality: ReviewQuality,
  now: number,
  timeZone: string,
): ConceptMastery {
  const zone = zoneOrUtc(timeZone);
  const ease = nextEase(Number.isFinite(row.easiness) ? row.easiness : SM2_DEFAULT_EASE, quality);
  if (quality < 3) {
    return {
      ...row,
      easiness: ease,
      repetitions: 0,
      intervalDays: 0,
      dueAt: now,
      lastQuality: quality,
      lastReviewedAt: now,
      correctStreak: 0,
    };
  }
  const wasScheduled = row.dueAt > 0;
  const repetitions = wasScheduled ? row.repetitions + 1 : 1;
  const intervalDays = nextIntervalDays(repetitions, wasScheduled ? row.intervalDays : 0, ease);
  return {
    ...row,
    easiness: ease,
    repetitions,
    intervalDays,
    dueAt: dueAtForInterval(intervalDays, now, zone),
    lastQuality: quality,
    lastReviewedAt: now,
    correctStreak: wasScheduled && quality >= 3 ? row.correctStreak + 1 : 1,
  };
}

/** Legacy dueAt 0 is unscheduled and is not due, including when the clock is 0. */
export function isConceptDue(row: Pick<ConceptMastery, "dueAt">, now: number): boolean {
  return row.dueAt > 0 && row.dueAt <= now;
}

/** Most overdue first. Untagged and unscheduled rows are omitted. */
export function dueConcepts(mastery: Record<string, ConceptMastery>, now: number): ConceptMastery[] {
  return Object.values(mastery)
    .filter((row) => row && isConceptDue(row, now))
    .sort(
      (a, b) => a.dueAt - b.dueAt || a.conceptLabel.localeCompare(b.conceptLabel) || a.conceptId.localeCompare(b.conceptId),
    );
}

export function learnerTimeZone(stored: string | null | undefined): string {
  if (stored && isIanaTimeZone(stored)) return stored;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isIanaTimeZone(zone)) return zone;
  } catch {
    /* UTC below */
  }
  return "UTC";
}

function withoutAlternate(item: QuizItem): QuizItem {
  if (!item.alternate) return item;
  const { alternate: _alternate, ...rest } = item;
  return rest;
}

/**
 * Real questions only: each tagged quiz item, plus its teach-time alternate when
 * that alternate carries the same conceptId. Nothing is generated here.
 */
export function conceptItemBank(plan: {
  lessons: { quiz: QuizItem[] }[];
  finalAssessment?: QuizItem[];
}): Map<string, QuizItem[]> {
  const bank = new Map<string, QuizItem[]>();
  const push = (conceptId: string, item: QuizItem) => {
    const question = item.question.trim();
    if (!question) return;
    const list = bank.get(conceptId) ?? [];
    if (list.some((existing) => existing.question === item.question && existing.kind === item.kind)) return;
    list.push(withoutAlternate(item));
    bank.set(conceptId, list);
  };
  const take = (item: QuizItem) => {
    if (!item.conceptId) return;
    push(item.conceptId, item);
    const alternate = item.alternate;
    if (alternate?.conceptId === item.conceptId) push(item.conceptId, alternate as QuizItem);
  };
  for (const lesson of plan.lessons) {
    for (const item of lesson.quiz) take(item);
  }
  for (const item of plan.finalAssessment ?? []) take(item);
  return bank;
}

/**
 * Draw a bank item that was not just shown.
 * The quiz shows the original, so the first review prefers the alternate.
 * With no alternate, the original is the only card.
 */
export function pickReviewItem(items: readonly QuizItem[], lastQuestion: string | null): QuizItem | null {
  if (items.length === 0) return null;
  const original = items[0]!;
  if (items.length === 1) return original;
  if (!lastQuestion) return items.find((item) => item.question !== original.question) ?? original;
  return items.find((item) => item.question !== lastQuestion) ?? original;
}

export type ReviewQueueEntry = { concept: ConceptMastery; items: QuizItem[]; lessonId: string };

export function reviewQueue(
  plan: { lessons: { id: string; quiz: QuizItem[] }[]; finalAssessment?: QuizItem[] },
  mastery: Record<string, ConceptMastery>,
  now: number,
): ReviewQueueEntry[] {
  const bank = conceptItemBank(plan);
  const entries: ReviewQueueEntry[] = [];
  for (const concept of dueConcepts(mastery, now)) {
    const items = bank.get(concept.conceptId);
    if (!items?.length) continue;
    const lessonId = reviewLessonId(plan, concept);
    if (!lessonId) continue;
    entries.push({ concept, items, lessonId });
  }
  return entries;
}

export function reviewLessonId(
  plan: { lessons: { id: string; quiz: QuizItem[] }[]; finalAssessment?: QuizItem[] },
  concept: Pick<ConceptMastery, "conceptId" | "lessonId">,
): string | null {
  if (concept.lessonId === "final") return "final";
  if (concept.lessonId && plan.lessons.some((lesson) => lesson.id === concept.lessonId)) return concept.lessonId;
  for (const lesson of plan.lessons) {
    if (lesson.quiz.some((item) => item.conceptId === concept.conceptId || item.alternate?.conceptId === concept.conceptId)) {
      return lesson.id;
    }
  }
  if (plan.finalAssessment?.some((item) => item.conceptId === concept.conceptId || item.alternate?.conceptId === concept.conceptId)) {
    return "final";
  }
  return null;
}

/** Collapse scoped or bare rows onto the concept id the plan DO stores. */
export function indexMasteryByConcept(
  mastery: Record<string, ConceptMastery> | null | undefined,
): Record<string, ConceptMastery> {
  const out: Record<string, ConceptMastery> = {};
  if (!mastery) return out;
  for (const row of Object.values(mastery)) {
    if (!row || typeof row.conceptId !== "string" || !row.conceptId) continue;
    const existing = out[row.conceptId];
    if (!existing || fresherThan(row, existing)) out[row.conceptId] = row;
  }
  return out;
}

function fresherThan(row: ConceptMastery, other: ConceptMastery): boolean {
  const rowAt = row.lastReviewedAt ?? 0;
  const otherAt = other.lastReviewedAt ?? 0;
  if (rowAt !== otherAt) return rowAt > otherAt;
  return (row.masteryRev ?? 0) > (other.masteryRev ?? 0);
}

/** Plan row wins a tie. A workspace row wins when it was reviewed later or has a higher revision. */
export function preferMasteryRows(
  plan: Record<string, ConceptMastery>,
  workspace: Record<string, ConceptMastery>,
): Record<string, ConceptMastery> {
  const next = { ...plan };
  for (const [id, row] of Object.entries(workspace)) {
    const stored = next[id];
    if (!stored || fresherThan(row, stored)) next[id] = row;
  }
  return next;
}

function highestRev(mastery: Record<string, ConceptMastery>): number {
  let rev = 0;
  for (const row of Object.values(mastery)) {
    if (typeof row.masteryRev === "number" && row.masteryRev > rev) rev = row.masteryRev;
  }
  return rev;
}

function answerBlank(answer: LearnAttemptAnswer): boolean {
  if (answer.skipped || answer.correct != null) return false;
  const choice = answer.mcChoice?.trim() ?? "";
  const text = answer.shortText.trim();
  return choice.length === 0 && (text.length === 0 || !answer.shortSubmitted);
}

/**
 * Apply SM-2 to each scheduled answer. Concepts absent from the attempt are unchanged.
 * If the workspace row was already updated for this same grade, keep it and only bump the revision.
 */
export function applyAttemptSchedule(
  mastery: Record<string, ConceptMastery>,
  attempt: LearnAttempt,
  now: number,
  timeZone: string,
): Record<string, ConceptMastery> {
  const next = { ...mastery };
  let rev = highestRev(next);
  const zone = zoneOrUtc(timeZone);
  for (const answer of attempt.answers) {
    if (!answer.conceptId || answer.applySchedule === false) continue;
    const current =
      next[answer.conceptId] ??
      newConceptMastery({
        conceptId: answer.conceptId,
        conceptLabel: answer.conceptLabel?.trim() || answer.conceptId,
        lessonId: attempt.target === "final" ? "final" : (attempt.lessonId ?? ""),
      });
    const quality = reviewQuality({
      correct: answer.correct,
      skipped: answer.skipped === true,
      blank: answerBlank(answer),
      firstTry: answer.firstTry,
      previousQuality: current.lastQuality,
    });
    const prior = answer.previousReviewedAt;
    const alreadyApplied =
      prior !== undefined && (current.lastReviewedAt ?? 0) > (prior ?? 0) && current.lastQuality === quality;
    rev += 1;
    next[answer.conceptId] = alreadyApplied
      ? { ...current, masteryRev: rev }
      : { ...scheduleConcept(current, quality, now, zone), masteryRev: rev };
  }
  return next;
}

/** Keep a local row when it was reviewed after the snapshot we just merged. */
export function keepFresherConceptMastery(local: LearnPlanProgress, merged: LearnPlanProgress): LearnPlanProgress {
  let changed = false;
  const conceptMastery = { ...merged.conceptMastery };
  for (const [key, row] of Object.entries(local.conceptMastery)) {
    const other = conceptMastery[key];
    if (!other || (row.lastReviewedAt ?? 0) > (other.lastReviewedAt ?? 0)) {
      if (other !== row) {
        conceptMastery[key] = row;
        changed = true;
      }
    }
  }
  return changed ? { ...merged, conceptMastery } : merged;
}

import type { LearnPlanProgress } from "./plan-progress.ts";

export type XpLogEntry = { at: number; amount: number; reason: string };

export type StatsSnapshot = {
  xp: number;
  streak: number;
  timezone: string | null;
  last_goal_date: string | null;
  last_activity_at: number | null;
  payload: { dailyGoalMet: string[]; xpLog: XpLogEntry[] };
};

export const XP_READ_LESSON = 15;
export const XP_QUIZ_CORRECT = 10;
export const XP_QUIZ_PARTIAL = 5;
export const XP_QUIZ_ATTEMPT = 2;

const MAX_LOG = 100;
const MAX_GOALS = 800;

export function emptyStats(): StatsSnapshot {
  return {
    xp: 0,
    streak: 0,
    timezone: null,
    last_goal_date: null,
    last_activity_at: null,
    payload: { dailyGoalMet: [], xpLog: [] },
  };
}

export function ymdInTimeZone(now: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Could not format the date.");
  return `${year}-${month}-${day}`;
}

export function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Add XP for one learning event and advance the streak when the local day changes.
 * The same reason is ignored, so a reload cannot award a lesson twice.
 */
export function awardLearning(
  current: StatsSnapshot,
  event: { reason: string; amount: number },
  now: number,
  timeZone: string,
): StatsSnapshot {
  if (!event.reason || event.amount < 0 || !Number.isInteger(event.amount)) return current;
  if (current.payload.xpLog.some((entry) => entry.reason === event.reason)) return current;
  const today = ymdInTimeZone(now, timeZone);
  let streak = current.streak;
  if (current.last_goal_date === today) streak = Math.max(streak, 1);
  else if (current.last_goal_date === shiftYmd(today, -1)) streak = Math.max(streak, 1) + 1;
  else streak = 1;
  const dailyGoalMet = current.payload.dailyGoalMet.includes(today)
    ? current.payload.dailyGoalMet
    : [...current.payload.dailyGoalMet, today].slice(-MAX_GOALS);
  const xpLog = [...current.payload.xpLog, { at: now, amount: event.amount, reason: event.reason }].slice(-MAX_LOG);
  return {
    xp: current.xp + event.amount,
    streak,
    timezone: timeZone,
    last_goal_date: today,
    last_activity_at: now,
    payload: { dailyGoalMet, xpLog },
  };
}

export type LessonMastery = { id: string; order: number; title: string; percent: number };

/**
 * Per-lesson mastery from quiz credit and reading.
 * A correct answer is full credit. Partial credit is half. Reading fills the rest, so marking a lesson read moves the number before the quiz.
 */
export function lessonMasteryPercent(input: {
  lessonId: string;
  quizCount: number;
  progress: LearnPlanProgress;
}): number {
  const { lessonId, quizCount, progress } = input;
  const read = progress.lessonReadDone[lessonId] ? 100 : Math.min(100, Math.max(0, progress.lessonReadScroll[lessonId] ?? 0));
  if (quizCount <= 0) return read;
  const quiz = progress.lessonQuiz[lessonId];
  let points = 0;
  for (let i = 0; i < quizCount; i++) {
    const answer = quiz?.answers[i];
    if (!answer) continue;
    if (answer.correct === true) points += 1;
    else if ((answer.score ?? 0) >= 0.4) points += 0.5;
  }
  if (points <= 0) return Math.round(read * 0.35);
  const quizPct = (points / quizCount) * 100;
  return Math.min(100, Math.round(quizPct * 0.75 + read * 0.25));
}

export function lessonMasteryList(
  lessons: { id: string; order: number; title: string; quizCount: number }[],
  progress: LearnPlanProgress,
): LessonMastery[] {
  return lessons.map((lesson) => ({
    id: lesson.id,
    order: lesson.order,
    title: lesson.title,
    percent: lessonMasteryPercent({ lessonId: lesson.id, quizCount: lesson.quizCount, progress }),
  }));
}

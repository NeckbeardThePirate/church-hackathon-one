import type { LearnPlanProgress } from "./plan-progress.ts";
import { lessonQuizFor, readDoneFor, readScrollFor, type ProgressScope } from "./progress-scope.ts";

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
/** Matches the workspace stats validator. Longer reasons are rejected and the whole save fails. */
const XP_REASON_MAX = 80;

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
 * Reason stored in xpLog and sent with the stats snapshot.
 * Path and plan ids are UUIDs, so `read:<project>:<plan>:<lesson>` is longer than the server allows.
 * Short codes keep that award key unique. Reasons that already fit are stored unchanged.
 */
export function xpLogReason(reason: string): string {
  if (reason.length <= XP_REASON_MAX) return reason;
  const read = /^read:([^:]+):([^:]+):([^:]+)$/.exec(reason);
  if (read) {
    const code = `r:${compactId(read[1]!)}:${compactId(read[2]!)}:${read[3]}`;
    if (code.length <= XP_REASON_MAX) return code;
  }
  const quiz = /^quiz:([^:]+):([^:]+):([^:]+):(\d+):(correct|partial|wrong)$/.exec(reason);
  if (quiz) {
    const outcome = quiz[5] === "correct" ? "c" : quiz[5] === "partial" ? "p" : "w";
    const code = `q:${compactId(quiz[1]!)}:${compactId(quiz[2]!)}:${quiz[3]}:${quiz[4]}:${outcome}`;
    if (code.length <= XP_REASON_MAX) return code;
  }
  return `x:${fnv1a32(reason)}`;
}

/** First 8 hex digits of a UUID. Other ids are kept, then capped so the code still fits. */
function compactId(id: string): string {
  const hex = id.replace(/-/g, "");
  if (/^[0-9a-f]{32}$/i.test(hex)) return hex.slice(0, 8).toLowerCase();
  return id.length > 24 ? id.slice(0, 24) : id;
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
  const code = xpLogReason(event.reason);
  const aliases = new Set<string>([code, event.reason]);
  for (const reason of equivalentReasons(event.reason)) {
    aliases.add(reason);
    aliases.add(xpLogReason(reason));
  }
  if ([...aliases].some((reason) => current.payload.xpLog.some((entry) => entry.reason === reason))) {
    return current;
  }
  const today = ymdInTimeZone(now, timeZone);
  let streak = current.streak;
  if (current.last_goal_date === today) streak = Math.max(streak, 1);
  else if (current.last_goal_date === shiftYmd(today, -1)) streak = Math.max(streak, 1) + 1;
  else streak = 1;
  const dailyGoalMet = current.payload.dailyGoalMet.includes(today)
    ? current.payload.dailyGoalMet
    : [...current.payload.dailyGoalMet, today].slice(-MAX_GOALS);
  const xpLog = [...current.payload.xpLog, { at: now, amount: event.amount, reason: code }].slice(-MAX_LOG);
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

/** Header and sidebar numbers. A null snapshot is still loading, so the UI must not show 0. */
export function statsFigures(stats: { xp: number; streak: number } | null): { xp: string; streak: string; busy: boolean } {
  if (!stats) return { xp: "…", streak: "…", busy: true };
  return { xp: String(stats.xp), streak: String(stats.streak), busy: false };
}

/**
 * Reasons already awarded before plan id was part of the key.
 * `read:project:plan:lesson` matches a stored `read:project:lesson`.
 */
function equivalentReasons(reason: string): string[] {
  const reasons = [reason];
  const read = /^read:([^:]+):([^:]+):([^:]+)$/.exec(reason);
  if (read) reasons.push(`read:${read[1]}:${read[3]}`);
  const quiz = /^quiz:([^:]+):([^:]+):([^:]+):(\d+):(correct|partial|wrong)$/.exec(reason);
  if (quiz) reasons.push(`quiz:${quiz[1]}:${quiz[3]}:${quiz[4]}:${quiz[5]}`);
  return reasons;
}

/**
 * Per-lesson mastery from quiz credit and reading for one path.
 * A correct answer is full credit. Partial credit is half. Reading fills the rest, so marking a lesson read moves the number before the quiz.
 */
export function lessonMasteryPercent(input: {
  scope: ProgressScope;
  lessonId: string;
  quizCount: number;
  progress: LearnPlanProgress;
}): number {
  const { scope, lessonId, quizCount, progress } = input;
  const read = readDoneFor(progress, scope, lessonId) ? 100 : Math.min(100, Math.max(0, readScrollFor(progress, scope, lessonId)));
  if (quizCount <= 0) return read;
  const quiz = lessonQuizFor(progress, scope, lessonId);
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
  scope: ProgressScope,
): LessonMastery[] {
  return lessons.map((lesson) => ({
    id: lesson.id,
    order: lesson.order,
    title: lesson.title,
    percent: lessonMasteryPercent({ scope, lessonId: lesson.id, quizCount: lesson.quizCount, progress }),
  }));
}

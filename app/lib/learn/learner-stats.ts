import type { LearnPlanProgress } from "./plan-progress.ts";
import { lessonQuizFor, readDoneFor, readScrollFor, type ProgressScope } from "./progress-scope.ts";

export type XpLogEntry = { at: number; amount: number; reason: string };

/**
 * Base learning events. The server assigns the amount from the kind.
 * Goal and streak bonuses are added by the award function, not by the client.
 */
export const XP_AMOUNTS = {
  read: 10,
  first: 5,
  quiz: 20,
  gap: 40,
  final: 25,
  reviews: 15,
} as const;

export type XpEventKind = keyof typeof XP_AMOUNTS;

export const XP_READ_LESSON = XP_AMOUNTS.read;
export const XP_FIRST_TRY = XP_AMOUNTS.first;
export const XP_QUIZ_SUBMIT = XP_AMOUNTS.quiz;
export const XP_GAP_COMPLETE = XP_AMOUNTS.gap;
export const XP_FINAL = XP_AMOUNTS.final;
export const XP_REVIEWS = XP_AMOUNTS.reviews;
export const XP_DAILY_GOAL = 10;
export const XP_STREAK_PER_DAY = 5;
export const XP_STREAK_CAP = 50;
/** Base XP, not counting the goal bonus or the streak bonus, that meets the daily goal. */
export const DAILY_GOAL_XP = 30;

export type XpEvent = { reason: string; kind: XpEventKind };

export type StatsPayload = {
  dailyGoalMet: string[];
  xpLog: XpLogEntry[];
  /** Every reason ever awarded. Survives xpLog trimming so a reload cannot pay twice. */
  awarded: string[];
  /** Base XP on todayYmd. Bonuses are not included. */
  todayXp: number;
  todayYmd: string | null;
};

export type StatsSnapshot = {
  xp: number;
  streak: number;
  timezone: string | null;
  last_goal_date: string | null;
  last_activity_at: number | null;
  payload: StatsPayload;
};

const MAX_LOG = 100;
const MAX_GOALS = 800;
const MAX_AWARDED = 4000;
/** Matches the workspace stats validator. Longer reasons are rejected and the whole save fails. */
const XP_REASON_MAX = 80;
const MAX_EVENTS = 40;

export function emptyStats(): StatsSnapshot {
  return {
    xp: 0,
    streak: 0,
    timezone: null,
    last_goal_date: null,
    last_activity_at: null,
    payload: { dailyGoalMet: [], xpLog: [], awarded: [], todayXp: 0, todayYmd: null },
  };
}

export function isIanaTimeZone(value: string): boolean {
  if (!value || value.length > 100) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
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

/** Idempotency key for one award. UUIDs are shortened so the key fits the server limit. */
export function xpReason(kind: XpEventKind, parts: readonly string[]): string {
  const body = parts.map((part) => compactId(part)).filter(Boolean).join(":");
  const reason = body ? `${kind}:${body}` : `${kind}:`;
  if (reason.length <= XP_REASON_MAX) return reason;
  return `${kind}:${fnv1a32(parts.join("\u001f"))}`;
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

/** First 8 hex digits of a UUID. Other ids stay whole so a long review stamp is not cut down to a colliding prefix. */
function compactId(id: string): string {
  const hex = id.replace(/-/g, "");
  if (/^[0-9a-f]{32}$/i.test(hex)) return hex.slice(0, 8).toLowerCase();
  return id;
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export type XpAwardResult = {
  stats: StatsSnapshot;
  accepted: { reason: string; amount: number; kind: XpEventKind | "goal" | "streak" }[];
  error?: string;
};

/**
 * Apply learning events. Amounts come from the kind, never from the caller.
 * A reason that was already awarded is skipped, including after the visible log is trimmed.
 * The day boundary is the stored timezone once one has been saved.
 * Streak and last_goal_date move only when today's base XP reaches the daily goal.
 */
export function applyXpAwards(
  current: StatsSnapshot,
  events: readonly XpEvent[],
  now: number,
  timeZone: string | null,
): XpAwardResult {
  const storedZone = current.timezone && isIanaTimeZone(current.timezone) ? current.timezone : null;
  const incomingZone = timeZone && isIanaTimeZone(timeZone) ? timeZone : null;
  const zone = storedZone ?? incomingZone;
  if (!zone) {
    return { stats: current, accepted: [], error: "A time zone is required before XP can be saved." };
  }
  const ready = normalizeSnapshot(current);
  let stats: StatsSnapshot = storedZone ? ready : { ...ready, timezone: zone };
  const accepted: XpAwardResult["accepted"] = [];
  const known = awardedSet(stats);
  const today = ymdInTimeZone(now, zone);
  let todayXp = baseToday(stats, today, zone);
  let streak = stats.streak;
  let lastGoal = stats.last_goal_date;
  let moved = stats.timezone !== current.timezone;

  for (const event of events) {
    if (!event || !isXpEventKind(event.kind)) continue;
    const reason = xpLogReason(event.reason);
    if (!reason.startsWith(`${event.kind}:`) || reason.length > XP_REASON_MAX) continue;
    if (seen(known, reason)) continue;
    const amount = XP_AMOUNTS[event.kind];
    todayXp += amount;
    stats = appendAward(stats, { at: now, amount, reason }, known);
    accepted.push({ reason, amount, kind: event.kind });
    moved = true;
  }

  if (accepted.length > 0) {
    const metBefore = lastGoal === today || seen(known, `goal:${today}`);
    const meetsNow = todayXp >= DAILY_GOAL_XP && !metBefore;
    if (meetsNow) {
      if (lastGoal === shiftYmd(today, -1)) streak = Math.max(streak, 1) + 1;
      else streak = 1;
      lastGoal = today;
    }
    stats = {
      ...stats,
      streak,
      last_goal_date: lastGoal,
      last_activity_at: now,
      payload: { ...stats.payload, todayXp, todayYmd: today },
    };
    if (meetsNow) {
      const goalReason = `goal:${today}`;
      stats = appendAward(stats, { at: now, amount: XP_DAILY_GOAL, reason: goalReason }, known);
      accepted.push({ reason: goalReason, amount: XP_DAILY_GOAL, kind: "goal" });
      const dailyGoalMet = stats.payload.dailyGoalMet.includes(today)
        ? stats.payload.dailyGoalMet
        : [...stats.payload.dailyGoalMet, today].slice(-MAX_GOALS);
      stats = { ...stats, payload: { ...stats.payload, dailyGoalMet } };
      const bonus = Math.min(Math.max(streak, 1) * XP_STREAK_PER_DAY, XP_STREAK_CAP);
      const streakReason = `streak:${today}`;
      if (bonus > 0 && !seen(known, streakReason)) {
        stats = appendAward(stats, { at: now, amount: bonus, reason: streakReason }, known);
        accepted.push({ reason: streakReason, amount: bonus, kind: "streak" });
      }
    }
  }

  if (!moved) return { stats: current, accepted: [] };
  return { stats, accepted };
}

export type DailyGoalStatus = {
  earned: number;
  target: number;
  met: boolean;
  percent: number;
};

/** Today's base XP against the daily goal, using the stored timezone. */
export function dailyGoalStatus(stats: StatsSnapshot | null, now: number): DailyGoalStatus {
  const target = DAILY_GOAL_XP;
  if (!stats?.timezone || !isIanaTimeZone(stats.timezone)) {
    return { earned: 0, target, met: false, percent: 0 };
  }
  const today = ymdInTimeZone(now, stats.timezone);
  const ready = normalizeSnapshot(stats);
  const earned = baseToday(ready, today, stats.timezone);
  const met = earned >= target || ready.payload.awarded.includes(`goal:${today}`);
  const percent = Math.max(0, Math.min(100, Math.round((Math.min(earned, target) / target) * 100)));
  return { earned, target, met, percent };
}

export function parseXpAwardRequest(
  body: unknown,
): { ok: true; timezone: string | null; events: XpEvent[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Award body must be an object." };
  }
  const raw = body as Record<string, unknown>;
  let timezone: string | null = null;
  if ("timezone" in raw && raw.timezone != null) {
    if (typeof raw.timezone !== "string" || !isIanaTimeZone(raw.timezone)) {
      return { ok: false, error: "timezone must be an IANA name." };
    }
    timezone = raw.timezone;
  }
  if (!("events" in raw)) return { ok: false, error: "events must be a list of awards." };
  if (!Array.isArray(raw.events) || raw.events.length > MAX_EVENTS) {
    return { ok: false, error: "events must be a short list of awards." };
  }
  const events: XpEvent[] = [];
  for (const item of raw.events) {
    if (!item || typeof item !== "object") return { ok: false, error: "Each award needs a kind and a reason." };
    const row = item as Record<string, unknown>;
    if (!isXpEventKind(row.kind)) return { ok: false, error: "Award kind is not one this app gives XP for." };
    if (typeof row.reason !== "string" || !row.reason.startsWith(`${row.kind}:`) || row.reason.length > XP_REASON_MAX) {
      return { ok: false, error: "Award reason must match its kind and stay short." };
    }
    events.push({ kind: row.kind, reason: row.reason });
  }
  return { ok: true, timezone, events };
}

function isXpEventKind(value: unknown): value is XpEventKind {
  return value === "read" || value === "first" || value === "quiz" || value === "gap" || value === "final" || value === "reviews";
}

function normalizeSnapshot(stats: StatsSnapshot): StatsSnapshot {
  const xpLog = Array.isArray(stats.payload?.xpLog) ? stats.payload.xpLog : [];
  const awarded = Array.isArray(stats.payload?.awarded) ? stats.payload.awarded : xpLog.map((entry) => entry.reason);
  return {
    ...stats,
    payload: {
      dailyGoalMet: Array.isArray(stats.payload?.dailyGoalMet) ? stats.payload.dailyGoalMet : [],
      xpLog,
      awarded,
      todayXp: typeof stats.payload?.todayXp === "number" ? stats.payload.todayXp : 0,
      todayYmd: typeof stats.payload?.todayYmd === "string" ? stats.payload.todayYmd : null,
    },
  };
}

function awardedSet(stats: StatsSnapshot): Set<string> {
  return new Set([...stats.payload.awarded, ...stats.payload.xpLog.map((entry) => entry.reason)]);
}

function seen(known: Set<string>, reason: string): boolean {
  for (const alias of reasonAliases(reason)) {
    if (known.has(alias)) return true;
  }
  return false;
}

function appendAward(stats: StatsSnapshot, entry: XpLogEntry, known: Set<string>): StatsSnapshot {
  for (const alias of reasonAliases(entry.reason)) known.add(alias);
  const awarded = [...stats.payload.awarded, entry.reason].slice(-MAX_AWARDED);
  const xpLog = [...stats.payload.xpLog, entry].slice(-MAX_LOG);
  return {
    ...stats,
    xp: stats.xp + entry.amount,
    payload: { ...stats.payload, awarded, xpLog },
  };
}

function baseToday(stats: StatsSnapshot, today: string, zone: string): number {
  if (stats.payload.todayYmd === today) return Math.max(0, stats.payload.todayXp);
  return stats.payload.xpLog.reduce((sum, entry) => {
    if (isBonusReason(entry.reason)) return sum;
    try {
      return ymdInTimeZone(entry.at, zone) === today ? sum + entry.amount : sum;
    } catch {
      return sum;
    }
  }, 0);
}

function isBonusReason(reason: string): boolean {
  return reason.startsWith("goal:") || reason.startsWith("streak:");
}

function reasonAliases(reason: string): string[] {
  const out = new Set<string>([reason]);
  const add = (value: string) => {
    if (value) out.add(value);
  };
  add(xpLogReason(reason));
  for (const alias of equivalentReasons(reason)) {
    add(alias);
    add(xpLogReason(alias));
  }
  const compactRead = /^r:([^:]+):([^:]+):([^:]+)$/.exec(reason);
  if (compactRead) add(`read:${compactRead[1]}:${compactRead[2]}:${compactRead[3]}`);
  const shortRead = /^read:([^:]+):([^:]+):([^:]+)$/.exec(reason);
  if (shortRead) add(`r:${shortRead[1]}:${shortRead[2]}:${shortRead[3]}`);
  return [...out];
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

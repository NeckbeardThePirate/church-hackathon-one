/**
 * UserWorkspaceDO SQLite schema and the single learner_stats row.
 * Kept free of cloudflare:workers so migrations can run under node:sqlite.
 */

export const WORKSPACE_SCHEMA_VERSION = 3;

/** Spec shape. timezone is NOT NULL; an unknown zone is stored as "". */
export const LEARNER_STATS_SQL = `
CREATE TABLE IF NOT EXISTS learner_stats (
   id INTEGER PRIMARY KEY CHECK (id = 1),
   xp INTEGER NOT NULL DEFAULT 0,
   streak INTEGER NOT NULL DEFAULT 0,
   timezone TEXT NOT NULL,
   last_goal_date TEXT,      -- YYYY-MM-DD in the stored timezone
   last_activity_at INTEGER,
   payload TEXT NOT NULL     -- dailyGoalMet dates, xp log (capped)
);
`;

export type WorkspaceSql = {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { one(): Record<string, unknown>; toArray(): Record<string, unknown>[] };
};

export type XpLogEntry = {
  at: number;
  amount: number;
  reason: string;
};

export type LearnerStatsPayload = {
  dailyGoalMet: string[];
  xpLog: XpLogEntry[];
};

export type LearnerStats = {
  xp: number;
  streak: number;
  /** Null until the client sends an IANA zone. Never invented here. */
  timezone: string | null;
  last_goal_date: string | null;
  last_activity_at: number | null;
  payload: LearnerStatsPayload;
};

export class StatsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatsInputError";
  }
}

const MAX_XP = 1_000_000_000;
const MAX_STREAK = 100_000;
const MAX_LOG = 100;
const MAX_GOAL_DATES = 800;
const MAX_ACTIVITY_AT = 10_000_000_000_000;

export function emptyLearnerStats(): LearnerStats {
  return {
    xp: 0,
    streak: 0,
    timezone: null,
    last_goal_date: null,
    last_activity_at: null,
    payload: { dailyGoalMet: [], xpLog: [] },
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

export function isYmdDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

type ParseResult = { ok: true; stats: LearnerStats } | { ok: false; error: string };

export function parseLearnerStatsPut(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Stats body must be an object." };
  }
  const raw = body as Record<string, unknown>;
  if (!Object.hasOwn(raw, "xp") || !Object.hasOwn(raw, "streak") || !Object.hasOwn(raw, "timezone") || !Object.hasOwn(raw, "last_goal_date")) {
    return { ok: false, error: "xp, streak, timezone, and last_goal_date are required." };
  }
  if (typeof raw.xp !== "number" || !Number.isInteger(raw.xp) || raw.xp < 0 || raw.xp > MAX_XP) {
    return { ok: false, error: "xp must be a whole number from 0 up." };
  }
  if (typeof raw.streak !== "number" || !Number.isInteger(raw.streak) || raw.streak < 0 || raw.streak > MAX_STREAK) {
    return { ok: false, error: "streak must be a whole number from 0 up." };
  }
  let timezone: string | null;
  if (raw.timezone === null) timezone = null;
  else if (typeof raw.timezone === "string" && isIanaTimeZone(raw.timezone)) timezone = raw.timezone;
  else return { ok: false, error: "timezone must be an IANA name, or null if it is not known yet." };

  let lastGoalDate: string | null;
  if (raw.last_goal_date === null) lastGoalDate = null;
  else if (typeof raw.last_goal_date === "string" && isYmdDate(raw.last_goal_date)) lastGoalDate = raw.last_goal_date;
  else return { ok: false, error: "last_goal_date must be YYYY-MM-DD, or null." };

  let lastActivityAt: number | null = null;
  if (raw.last_activity_at !== undefined && raw.last_activity_at !== null) {
    if (
      typeof raw.last_activity_at !== "number" ||
      !Number.isInteger(raw.last_activity_at) ||
      raw.last_activity_at < 0 ||
      raw.last_activity_at > MAX_ACTIVITY_AT
    ) {
      return { ok: false, error: "last_activity_at must be a unix millisecond timestamp, or null." };
    }
    lastActivityAt = raw.last_activity_at;
  }

  const payload = parsePayload(raw.payload);
  if (!payload.ok) return payload;

  return {
    ok: true,
    stats: {
      xp: raw.xp,
      streak: raw.streak,
      timezone,
      last_goal_date: lastGoalDate,
      last_activity_at: lastActivityAt,
      payload: payload.payload,
    },
  };
}

function parsePayload(value: unknown): { ok: true; payload: LearnerStatsPayload } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, payload: { dailyGoalMet: [], xpLog: [] } };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "payload must be an object." };
  }
  const raw = value as Record<string, unknown>;
  const daily = raw.dailyGoalMet === undefined ? [] : raw.dailyGoalMet;
  const log = raw.xpLog === undefined ? [] : raw.xpLog;
  if (!Array.isArray(daily) || daily.length > MAX_GOAL_DATES || daily.some((item) => typeof item !== "string" || !isYmdDate(item))) {
    return { ok: false, error: "payload.dailyGoalMet must be a list of YYYY-MM-DD dates." };
  }
  if (!Array.isArray(log) || log.length > MAX_LOG) {
    return { ok: false, error: "payload.xpLog is too long." };
  }
  const xpLog: XpLogEntry[] = [];
  for (const item of log) {
    if (!item || typeof item !== "object") return { ok: false, error: "payload.xpLog entries must be objects." };
    const row = item as Record<string, unknown>;
    if (typeof row.at !== "number" || !Number.isInteger(row.at) || row.at < 0) {
      return { ok: false, error: "payload.xpLog at must be a timestamp." };
    }
    if (typeof row.amount !== "number" || !Number.isInteger(row.amount) || row.amount < 0 || row.amount > MAX_XP) {
      return { ok: false, error: "payload.xpLog amount must be a whole number from 0 up." };
    }
    if (typeof row.reason !== "string" || row.reason.length > 80) {
      return { ok: false, error: "payload.xpLog reason must be a short string." };
    }
    xpLog.push({ at: row.at, amount: row.amount, reason: row.reason });
  }
  return { ok: true, payload: { dailyGoalMet: daily as string[], xpLog } };
}

type StatsRow = {
  xp: number | bigint;
  streak: number | bigint;
  timezone: string | null;
  last_goal_date: string | null;
  last_activity_at: number | bigint | null;
  payload: string;
};

function asInt(value: unknown, fallback = 0): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function rowToStats(row: StatsRow): LearnerStats {
  const timezone = typeof row.timezone === "string" && row.timezone.length > 0 ? row.timezone : null;
  let payload = emptyLearnerStats().payload;
  try {
    const parsed = parsePayload(JSON.parse(row.payload));
    if (parsed.ok) payload = parsed.payload;
  } catch {
    payload = emptyLearnerStats().payload;
  }
  return {
    xp: asInt(row.xp),
    streak: asInt(row.streak),
    timezone,
    last_goal_date: typeof row.last_goal_date === "string" && isYmdDate(row.last_goal_date) ? row.last_goal_date : null,
    last_activity_at: row.last_activity_at == null ? null : asInt(row.last_activity_at),
    payload,
  };
}

/**
 * Bring a workspace database to the requested schema version.
 * Safe to run more than once, including on a database that already has projects and oauth.
 */
export function applyWorkspaceMigrations(sql: WorkspaceSql, target = WORKSPACE_SCHEMA_VERSION): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  let version = asInt(sql.exec("SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations").one().version);

  if (version < 1 && target >= 1) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        import_complete INTEGER NOT NULL,
        payload TEXT NOT NULL
      )
    `);
    sql.exec("CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects (updated_at DESC)");
    sql.exec(`
      CREATE TABLE IF NOT EXISTS prefs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    sql.exec("INSERT INTO _sql_schema_migrations (id) VALUES (1)");
    version = 1;
  }
  if (version < 2 && target >= 2) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS oauth (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL
      )
    `);
    sql.exec("INSERT INTO _sql_schema_migrations (id) VALUES (2)");
    version = 2;
  }
  if (target >= 3) {
    sql.exec(LEARNER_STATS_SQL);
    if (version < 3) sql.exec("INSERT INTO _sql_schema_migrations (id) VALUES (3)");
  }
}

/** No row yet: zeros and a null timezone. Does not insert. */
export function readLearnerStats(sql: WorkspaceSql): LearnerStats {
  const rows = sql
    .exec("SELECT xp, streak, timezone, last_goal_date, last_activity_at, payload FROM learner_stats WHERE id = 1")
    .toArray() as StatsRow[];
  const row = rows[0];
  if (!row) return emptyLearnerStats();
  return rowToStats(row);
}

export function writeLearnerStats(sql: WorkspaceSql, stats: LearnerStats): void {
  sql.exec(
    `INSERT INTO learner_stats (id, xp, streak, timezone, last_goal_date, last_activity_at, payload)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       xp = excluded.xp,
       streak = excluded.streak,
       timezone = excluded.timezone,
       last_goal_date = excluded.last_goal_date,
       last_activity_at = excluded.last_activity_at,
       payload = excluded.payload`,
    stats.xp,
    stats.streak,
    stats.timezone ?? "",
    stats.last_goal_date,
    stats.last_activity_at,
    JSON.stringify(stats.payload),
  );
}

export function setLearnerStats(sql: WorkspaceSql, input: unknown): LearnerStats {
  const parsed = parseLearnerStatsPut(input);
  if (!parsed.ok) throw new StatsInputError(parsed.error);
  writeLearnerStats(sql, parsed.stats);
  return readLearnerStats(sql);
}

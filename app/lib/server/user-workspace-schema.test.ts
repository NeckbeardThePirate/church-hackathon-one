import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { handleStatsGet, handleStatsPut } from "./workspace-stats.ts";
import {
  applyLearnerStatsPatch,
  applyWorkspaceMigrations,
  readLearnerStats,
  WORKSPACE_SCHEMA_VERSION,
  writeLearnerStats,
  type LearnerStats,
  type LearnerStatsPatch,
  type WorkspaceSql,
} from "./user-workspace-schema.ts";

function open(): { db: DatabaseSync; sql: WorkspaceSql } {
  const db = new DatabaseSync(":memory:");
  const sql: WorkspaceSql = {
    exec(query, ...bindings) {
      const rows = db.prepare(query).all(...(bindings as (string | number | null | bigint)[])) as Record<string, unknown>[];
      return {
        one: () => {
          const row = rows[0];
          if (!row) throw new Error(`Expected a row for: ${query}`);
          return row;
        },
        toArray: () => rows,
      };
    },
  };
  return { db, sql };
}

function count(db: DatabaseSync, table: "learner_stats" | "projects" | "_sql_schema_migrations"): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number | bigint };
  return Number(row.n);
}

const roundTrip = {
  xp: 35,
  streak: 4,
  timezone: "America/Los_Angeles",
  last_goal_date: "2026-11-17",
  last_activity_at: 1_700_000_000_000,
  payload: { dailyGoalMet: ["2026-11-17"], xpLog: [{ at: 1_700_000_000_000, amount: 10, reason: "lesson" }] },
};

test("schema v3 migrates an existing v2 workspace once and get/set keeps a single stats row", () => {
  const { db, sql } = open();
  applyWorkspaceMigrations(sql, 2);
  db.prepare(
    "INSERT INTO projects (id, kind, title, updated_at, import_complete, payload) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("lesson-1", "lesson", "Archived", 20, 1, JSON.stringify({ id: "lesson-1", kind: "lesson", title: "Archived" }));
  assert.equal(count(db, "_sql_schema_migrations"), 2);
  const statsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'learner_stats'").all();
  assert.equal(statsTable.length, 0);

  applyWorkspaceMigrations(sql);
  applyWorkspaceMigrations(sql);
  assert.equal(count(db, "_sql_schema_migrations"), 3);
  assert.equal(count(db, "projects"), 1);
  const payload = db.prepare("SELECT payload FROM projects WHERE id = ?").get("lesson-1") as { payload: string };
  assert.equal(payload.payload.includes("Archived"), true);
  assert.equal(count(db, "learner_stats"), 0);
  const first = readLearnerStats(sql);
  assert.equal(first.xp, 0);
  assert.equal(first.streak, 0);
  assert.equal(first.timezone, null);
  assert.equal(first.last_goal_date, null);

  writeLearnerStats(sql, roundTrip);
  writeLearnerStats(sql, { ...roundTrip, xp: 40, streak: 4 });
  applyWorkspaceMigrations(sql);
  assert.equal(count(db, "learner_stats"), 1);
  const stored = readLearnerStats(sql);
  assert.equal(stored.xp, 40);
  assert.equal(stored.streak, 4);
  assert.equal(stored.timezone, "America/Los_Angeles");
  assert.equal(stored.last_goal_date, "2026-11-17");
  assert.equal(stored.last_activity_at, roundTrip.last_activity_at);
  assert.deepEqual(stored.payload, roundTrip.payload);
});

test("stats routes require sign-in and round-trip xp, streak, timezone, and last_goal_date", async () => {
  const { db, sql } = open();
  applyWorkspaceMigrations(sql);
  const auth = { userId: "user_1" };
  let reads = 0;
  const denied = await handleStatsGet(Response.json({ error: "Sign in required." }, { status: 401 }), () => {
    reads += 1;
    return readLearnerStats(sql);
  });
  assert.equal(denied.status, 401);
  assert.equal(reads, 0);

  const first = await handleStatsGet(auth, () => readLearnerStats(sql));
  const empty = (await first.json()) as LearnerStats;
  assert.equal(empty.xp, 0);
  assert.equal(empty.streak, 0);
  assert.equal(empty.timezone, null);
  assert.equal(empty.last_goal_date, null);
  assert.equal(count(db, "learner_stats"), 0);

  const save = (patch: LearnerStatsPatch) => {
    writeLearnerStats(sql, applyLearnerStatsPatch(readLearnerStats(sql), patch));
    return readLearnerStats(sql);
  };
  let writes = 0;
  const invalid = await handleStatsPut(auth, { ...roundTrip, timezone: "Not/AZone" }, (patch) => {
    writes += 1;
    return save(patch);
  });
  assert.equal(invalid.status, 400);
  assert.equal(writes, 0);

  const badDate = await handleStatsPut(auth, { ...roundTrip, last_goal_date: "2026-02-31" }, () => {
    writes += 1;
    return readLearnerStats(sql);
  });
  assert.equal(badDate.status, 400);
  const fractional = await handleStatsPut(auth, { ...roundTrip, xp: 1.5 }, () => {
    writes += 1;
    return readLearnerStats(sql);
  });
  assert.equal(fractional.status, 400);
  const negative = await handleStatsPut(auth, { ...roundTrip, streak: -1 }, () => {
    writes += 1;
    return readLearnerStats(sql);
  });
  assert.equal(negative.status, 400);
  assert.equal(writes, 0);
  assert.equal(count(db, "learner_stats"), 0);

  const saved = await handleStatsPut(auth, roundTrip, save);
  assert.equal(saved.status, 200);
  const body = (await saved.json()) as LearnerStats;
  assert.equal(body.xp, 35);
  assert.equal(body.streak, 4);
  assert.equal(body.timezone, "America/Los_Angeles");
  assert.equal(body.last_goal_date, "2026-11-17");

  const again = await handleStatsGet(auth, () => readLearnerStats(sql));
  assert.deepEqual(await again.json(), body);

  const unset = await handleStatsPut(auth, { ...roundTrip, timezone: null, last_goal_date: null }, save);
  const cleared = (await unset.json()) as LearnerStats;
  assert.equal(cleared.timezone, null);
  assert.equal(cleared.last_goal_date, null);
  assert.equal(cleared.xp, 35);
  const row = db.prepare("SELECT timezone FROM learner_stats WHERE id = 1").get() as { timezone: string };
  assert.equal(row.timezone, "");
  assert.equal(count(db, "learner_stats"), 1);

  const { payload: _payload, ...withoutPayload } = roundTrip;
  const omitted = await handleStatsPut(auth, { ...withoutPayload, xp: 41 }, save);
  const kept = (await omitted.json()) as LearnerStats;
  assert.equal(kept.xp, 41);
  assert.equal(kept.streak, 4);
  assert.equal(kept.timezone, "America/Los_Angeles");
  assert.equal(kept.last_goal_date, "2026-11-17");
  assert.equal(kept.payload.dailyGoalMet[0], "2026-11-17");
  assert.equal(kept.payload.xpLog[0]?.amount, 10);

  const onlyXp = await handleStatsPut(auth, { xp: 42 }, save);
  const still = (await onlyXp.json()) as LearnerStats;
  assert.equal(still.xp, 42);
  assert.equal(still.streak, 4);
  assert.equal(still.payload.xpLog[0]?.amount, 10);
  assert.equal(still.payload.dailyGoalMet[0], "2026-11-17");
});

test("schema 1 migrates to learner stats without dropping projects or prefs", () => {
  const { db, sql } = open();
  applyWorkspaceMigrations(sql, 1);
  assert.equal(count(db, "_sql_schema_migrations"), 1);
  const before = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('oauth', 'learner_stats')").all();
  assert.equal(before.length, 0);
  db.prepare(
    "INSERT INTO projects (id, kind, title, updated_at, import_complete, payload) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("p1", "study", "Kept", 10, 1, JSON.stringify({ id: "p1" }));
  db.prepare("INSERT INTO prefs (key, value) VALUES (?, ?)").run("fontScale", "1");

  applyWorkspaceMigrations(sql, WORKSPACE_SCHEMA_VERSION);
  applyWorkspaceMigrations(sql, WORKSPACE_SCHEMA_VERSION);
  const project = db.prepare("SELECT payload FROM projects WHERE id = ?").get("p1") as { payload: string };
  assert.equal(JSON.parse(project.payload).id, "p1");
  const pref = db.prepare("SELECT value FROM prefs WHERE key = ?").get("fontScale") as { value: string };
  assert.equal(pref.value, "1");
  const oauth = db.prepare("SELECT COUNT(*) AS n FROM oauth").get() as { n: number | bigint };
  assert.equal(Number(oauth.n), 0);
  const stats = readLearnerStats(sql);
  assert.equal(stats.xp, 0);
  assert.equal(stats.timezone, null);
  assert.equal(count(db, "learner_stats"), 0);
  const versions = db.prepare("SELECT id FROM _sql_schema_migrations ORDER BY id").all() as { id: number }[];
  assert.deepEqual(
    versions.map((row) => row.id),
    [1, 2, 3],
  );
});

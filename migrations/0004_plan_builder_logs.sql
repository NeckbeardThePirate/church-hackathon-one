-- Internal plan-builder notes (unresolved library and scripture references, and
-- other lesson warnings). Learners do not see these. The insert path also runs
-- these statements, so a missing migration does not stop plan generation.
-- Keep the statements in sync with app/lib/server/learn/plan-builder-log.ts.

CREATE TABLE IF NOT EXISTS plan_builder_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  lesson_order INTEGER,
  lesson_title TEXT,
  stage TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_builder_logs_plan ON plan_builder_logs(plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plan_builder_logs_kind ON plan_builder_logs(kind, created_at);

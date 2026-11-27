/**
 * Plan-builder notes used to render in the lesson ("Notes from the plan builder").
 * They stay off the lesson screen. Each new note is written to the worker log and,
 * when D1 is available, to `plan_builder_logs` for later review.
 * Storage failures never stop plan generation.
 */

/** Keep in sync with migrations/0004_plan_builder_logs.sql. */
export const PLAN_BUILDER_LOGS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS plan_builder_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  lesson_order INTEGER,
  lesson_title TEXT,
  stage TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT NOT NULL
)`;

export const PLAN_BUILDER_LOGS_PLAN_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS idx_plan_builder_logs_plan ON plan_builder_logs(plan_id, created_at)";

export const PLAN_BUILDER_LOGS_KIND_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS idx_plan_builder_logs_kind ON plan_builder_logs(kind, created_at)";

export type PlanBuilderNoteKind = "library_reference_dropped" | "scripture_reference_dropped" | "plan_builder";

export type PlanBuilderNoteInput = {
  planId: string;
  lessonId: string;
  lessonOrder?: number;
  lessonTitle?: string;
  stage: string;
  note: string;
};

type LessonWarningSource = {
  id: string;
  order?: number;
  title?: string;
  warnings?: string[];
};

export function planBuilderNoteKind(note: string): PlanBuilderNoteKind {
  if (note.startsWith("Library reference dropped")) return "library_reference_dropped";
  if (note.startsWith("Scripture reference dropped")) return "scripture_reference_dropped";
  return "plan_builder";
}

/** Notes that are not already stored on the lesson. */
export function freshPlanBuilderNotes(
  lesson: LessonWarningSource,
  warnings: string[],
  meta: { planId: string; stage: string },
): PlanBuilderNoteInput[] {
  const seen = new Set(lesson.warnings ?? []);
  const fresh: PlanBuilderNoteInput[] = [];
  for (const note of warnings) {
    const trimmed = note.trim();
    if (!trimmed || seen.has(note)) continue;
    seen.add(note);
    fresh.push({
      planId: meta.planId,
      lessonId: lesson.id,
      lessonOrder: lesson.order,
      lessonTitle: lesson.title,
      stage: meta.stage,
      note,
    });
  }
  return fresh;
}

export async function recordNewLessonWarnings(
  env: { BIBLE?: D1Database },
  input: { planId: string; stage: string; lesson: LessonWarningSource; warnings: string[] },
): Promise<void> {
  await recordPlanBuilderNotes(env, freshPlanBuilderNotes(input.lesson, input.warnings, input));
}

export async function recordPlanBuilderNotes(
  env: { BIBLE?: D1Database },
  notes: PlanBuilderNoteInput[],
): Promise<void> {
  if (!notes.length) return;
  for (const note of notes) {
    console.warn("[learn] plan builder note", {
      planId: note.planId,
      lessonId: note.lessonId,
      lessonOrder: note.lessonOrder ?? null,
      lessonTitle: note.lessonTitle ?? null,
      stage: note.stage,
      kind: planBuilderNoteKind(note.note),
      note: note.note,
    });
  }
  const db = env.BIBLE;
  if (!db) return;
  try {
    await ensurePlanBuilderLogs(db);
    await insertPlanBuilderNotes(db, notes);
  } catch (error) {
    console.warn(
      "[learn] plan builder note was not stored:",
      error instanceof Error ? error.message : error,
    );
  }
}

async function ensurePlanBuilderLogs(db: D1Database): Promise<void> {
  // Run in order. Preparing the index before the table exists fails on SQLite.
  await db.prepare(PLAN_BUILDER_LOGS_TABLE_SQL).run();
  await db.prepare(PLAN_BUILDER_LOGS_PLAN_INDEX_SQL).run();
  await db.prepare(PLAN_BUILDER_LOGS_KIND_INDEX_SQL).run();
}

async function insertPlanBuilderNotes(db: D1Database, notes: PlanBuilderNoteInput[]): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO plan_builder_logs
      (created_at, plan_id, lesson_id, lesson_order, lesson_title, stage, kind, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const createdAt = Date.now();
  await db.batch(
    notes.map((note) =>
      insert.bind(
        createdAt,
        note.planId,
        note.lessonId,
        note.lessonOrder ?? null,
        note.lessonTitle ?? null,
        note.stage,
        planBuilderNoteKind(note.note),
        note.note,
      ),
    ),
  );
}

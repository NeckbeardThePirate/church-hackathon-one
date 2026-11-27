import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  PLAN_BUILDER_LOGS_KIND_INDEX_SQL,
  PLAN_BUILDER_LOGS_PLAN_INDEX_SQL,
  PLAN_BUILDER_LOGS_TABLE_SQL,
  freshPlanBuilderNotes,
  planBuilderNoteKind,
  recordPlanBuilderNotes,
} from "./plan-builder-log.ts";

const NOTE = "Library reference dropped (did not resolve): Westminster Confession of Faith, 1.2";

test("plan builder note kinds separate unresolved library references", () => {
  assert.equal(planBuilderNoteKind(NOTE), "library_reference_dropped");
  assert.equal(
    planBuilderNoteKind("Scripture reference dropped (did not resolve in BSB): Romans 3:21-26"),
    "scripture_reference_dropped",
  );
  assert.equal(planBuilderNoteKind("Quiz has 1 items; band minimum is 3."), "plan_builder");
});

test("notes already on the lesson are not logged again", () => {
  const fresh = freshPlanBuilderNotes(
    { id: "gap-1", order: 2, title: "Practice", warnings: [NOTE] },
    [NOTE, "Scripture reference dropped (did not resolve in BSB): Romans 3:1"],
    { planId: "plan-1", stage: "teach" },
  );
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0]?.lessonId, "gap-1");
  assert.match(fresh[0]?.note ?? "", /Romans 3:1/);
});

test("a missing plan_builder_logs table is created and the note is stored", async () => {
  const db = new DatabaseSync(":memory:");
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await recordPlanBuilderNotes(asD1(db), [
      {
        planId: "plan-1",
        lessonId: "gap-1",
        lessonOrder: 2,
        lessonTitle: "Practice",
        stage: "teach",
        note: NOTE,
      },
    ]);
  } finally {
    console.warn = original;
  }

  const detail = warnings.find((args) => args[0] === "[learn] plan builder note")?.[1] as {
    planId?: string;
    lessonId?: string;
    note?: string;
    kind?: string;
  };
  assert.equal(detail.planId, "plan-1");
  assert.equal(detail.lessonId, "gap-1");
  assert.equal(detail.kind, "library_reference_dropped");
  assert.equal(detail.note, NOTE);

  const rows = db.prepare("SELECT plan_id, lesson_id, lesson_order, stage, kind, note FROM plan_builder_logs").all() as {
    plan_id: string;
    lesson_id: string;
    lesson_order: number;
    stage: string;
    kind: string;
    note: string;
  }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.plan_id, "plan-1");
  assert.equal(rows[0]?.lesson_id, "gap-1");
  assert.equal(rows[0]?.lesson_order, 2);
  assert.equal(rows[0]?.stage, "teach");
  assert.equal(rows[0]?.kind, "library_reference_dropped");
  assert.equal(rows[0]?.note, NOTE);
});

test("a D1 failure is logged and does not reject plan generation", async () => {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await recordPlanBuilderNotes(
      {
        BIBLE: {
          prepare() {
            throw new Error("d1 unavailable");
          },
          batch() {
            throw new Error("d1 unavailable");
          },
        },
      } as never,
      [
        {
          planId: "plan-1",
          lessonId: "l1",
          stage: "teach",
          note: NOTE,
        },
      ],
    );
  } finally {
    console.warn = original;
  }
  assert.match(warnings.map((args) => args.map(String).join(" ")).join("\n"), /was not stored/);
});

test("the D1 migration matches the runtime CREATE statements", () => {
  const migration = readFileSync(new URL("../../../../migrations/0004_plan_builder_logs.sql", import.meta.url), "utf8");
  assert.ok(migration.includes(PLAN_BUILDER_LOGS_TABLE_SQL));
  assert.ok(migration.includes(PLAN_BUILDER_LOGS_PLAN_INDEX_SQL));
  assert.ok(migration.includes(PLAN_BUILDER_LOGS_KIND_INDEX_SQL));
});

function asD1(db: DatabaseSync) {
  function statement(query: string) {
    const prepared = db.prepare(query);
    function make(args: unknown[]) {
      return {
        bind(...next: unknown[]) {
          return make(next);
        },
        async run() {
          prepared.run(...(args as (string | number | null | bigint)[]));
          return { success: true };
        },
      };
    }
    return make([]);
  }
  return {
    BIBLE: {
      prepare: statement,
      async batch(statements: { run: () => Promise<unknown> }[]) {
        const results = [];
        for (const item of statements) results.push(await item.run());
        return results;
      },
    },
  } as never;
}

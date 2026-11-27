import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { BudgetExhausted, runCheck, runTeach } from "./stages.ts";
import { BUDGET, LearnPlanDO } from "./plan-do.ts";
import { SESSION_COOKIE, signSession } from "../session.ts";
import { env as workersEnv } from "./cloudflare-workers-stub.ts";
import type { LearnLesson, LearnPlan, QuizItem } from "../../learn/types.ts";
import type { LearnMessage } from "./queues.ts";

const PLAN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SECRET = "gap-lesson-test-secret";

function memoryStorage() {
  const data = new Map<string, unknown>();
  const gets: (string | string[])[] = [];
  return {
    data,
    gets,
    storage: {
      get: async (key: string | string[]) => {
        gets.push(Array.isArray(key) ? [...key] : key);
        if (Array.isArray(key)) {
          const rows = new Map<string, unknown>();
          for (const item of key) if (data.has(item)) rows.set(item, data.get(item));
          return rows;
        }
        return data.get(key);
      },
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === "string") {
          data.set(key, value);
          return;
        }
        for (const [item, stored] of Object.entries(key)) data.set(item, stored);
      },
      delete: async (key: string) => {
        data.delete(key);
      },
      setAlarm: async () => {},
      deleteAlarm: async () => {},
      transactionSync: <T>(fn: () => T) => fn(),
      kv: {
        get: (key: string) => data.get(key),
        put: (key: string, value: unknown) => {
          data.set(key, value);
        },
      },
    },
  };
}

function lesson(id: string, order: number, title: string, conceptId: string): LearnLesson {
  return {
    id,
    order,
    title,
    objectives: ["Explain the main idea"],
    prerequisiteLessonIds: [],
    estimatedMinutes: 25,
    searchHints: ["introduction"],
    status: "ok",
    teaching: [{ type: "paragraph", text: "Faith receives a gift." }],
    videos: [],
    articles: [],
    books: [],
    scripture: [],
    library: [],
    quiz: [
      {
        kind: "mc",
        question: "What receives the gift?",
        choices: ["Faith", "Works"],
        answer: "Faith",
        rationale: "The lesson says faith receives a gift.",
        objectiveIndex: 0,
        conceptId,
        conceptLabel: "Faith",
      },
    ],
    warnings: [],
    kind: "core",
  };
}

const sentinel: QuizItem = {
  kind: "short",
  question: "Final sentinel",
  answer: "Keep",
  rationale: "Left out of the gap job.",
  objectiveIndex: 0,
};

function planBody(lessons: LearnLesson[]): LearnPlan {
  return {
    id: PLAN_ID,
    topic: "Faith",
    title: "Faith",
    complexity: "complex",
    perspective: "neutral",
    status: "complete",
    prerequisites: [],
    objectives: ["Explain the main idea"],
    lessons,
    courseBooks: [],
    finalAssessment: [sentinel],
    warnings: [],
    createdAt: 10,
  };
}

async function bootPlan(): Promise<LearnPlanDO> {
  const ctx = memoryStorage();
  const plan = new LearnPlanDO(ctx as never, {} as never);
  await plan.init({
    planId: PLAN_ID,
    userId: "user_a",
    topic: "Faith",
    notes: "",
    passages: [],
    options: { perspective: "neutral", includeScripture: "auto" },
  });
  await plan.setScope({
    title: "Faith",
    complexity: "complex",
    lessonCount: 6,
    prerequisites: [],
    coreConcepts: ["Faith"],
    objectives: ["Explain the main idea"],
    isFaithRelevant: true,
  });
  const first = lesson("l1", 1, "The gift", "l1-faith");
  const second = lesson("l2", 2, "The next idea", "l2-next");
  await plan.setOutline([
    {
      id: "l1",
      order: 1,
      title: "The gift",
      objectives: ["Explain the main idea"],
      prerequisiteLessonIds: [],
      estimatedMinutes: 25,
      searchHints: ["introduction"],
    },
    {
      id: "l2",
      order: 2,
      title: "The next idea",
      objectives: ["Explain the main idea"],
      prerequisiteLessonIds: ["l1"],
      estimatedMinutes: 25,
      searchHints: ["next"],
    },
  ]);
  await plan.putLesson(first);
  await plan.putLesson(second);
  await plan.complete(planBody([first, second]));
  return plan;
}

test("MOCK_AI builds one tagged gap lesson after its parent and ignores a second miss", async () => {
  const plan = await bootPlan();
  const sent: LearnMessage[] = [];
  const env = {
    MOCK_AI: "1",
    AI: {},
    LEARN_Q_CHECK: {
      send: async (message: LearnMessage) => {
        sent.push(message);
      },
    },
  };
  const reserved = await plan.reserveGap({
    sourceLessonId: "l1",
    concepts: [{ conceptId: "l1-faith", conceptLabel: "Faith" }],
  });
  assert.equal(reserved.queued, true);
  assert.equal(reserved.lessonId, "gap-l1-1");
  assert.equal(await plan.begin("teach:l1:r0"), false);
  assert.equal(await plan.begin(`gap:teach:${reserved.lessonId}:r0`), true);

  const teach = { planId: PLAN_ID, stage: "teach" as const, lessonId: reserved.lessonId, round: 0, job: "gap" as const };
  await runTeach({ env: env as never, msg: teach, stub: plan as never });
  assert.deepEqual(sent.map((message) => message.stage), ["check"]);
  assert.equal(sent[0]?.job, "gap");
  assert.equal(sent.some((message) => message.stage === "research" || message.stage === "critic" || message.stage === "assemble"), false);

  await runCheck({ env: env as never, msg: { ...teach, stage: "check" }, stub: plan as never });
  assert.equal(sent.length, 1);

  const snap = await plan.snapshot();
  assert.equal(snap.status, "complete");
  assert.deepEqual(snap.plan?.lessons.map((item) => item.id), ["l1", "gap-l1-1", "l2"]);
  assert.equal(snap.plan?.finalAssessment[0]?.question, "Final sentinel");
  const gap = snap.plan?.lessons[1];
  assert.ok(gap);
  assert.equal(gap.kind, "gap");
  assert.equal(gap.sourceLessonId, "l1");
  assert.deepEqual(gap.sourceConceptIds, ["l1-faith"]);
  assert.equal(gap.estimatedMinutes, 20);
  assert.equal(gap.objectives[0], "Review Faith");
  assert.ok(gap.quiz.length >= 3 && gap.quiz.length <= 4);
  assert.ok(gap.quiz.some((item) => item.kind === "mc"));
  assert.ok(gap.quiz.some((item) => item.kind === "short"));
  const slots = gap.quiz.flatMap((item) =>
    item.kind === "mc" && item.choices ? [item.choices.indexOf(item.answer)] : [],
  );
  assert.ok(slots.length >= 2);
  assert.equal(slots.every((slot) => slot === 1), false);
  assert.ok(new Set(slots).size > 1);
  for (const item of gap.quiz) {
    if (item.kind !== "mc" || !item.choices) continue;
    assert.ok(item.choices.includes(item.answer));
  }
  for (const item of gap.quiz) {
    assert.equal(item.conceptId, "l1-faith");
    assert.equal(item.conceptLabel, "Faith");
  }
  assert.ok(gap.quiz.some((item) => item.alternate?.conceptId === "l1-faith"));
  assert.deepEqual(gap.scripture, []);
  assert.match(gap.warnings.join("\n"), /did not resolve in BSB/);
  assert.match(gap.warnings.join("\n"), /Library reference dropped \(did not resolve\)/);
  assert.equal(gap.library?.length ?? 0, 0);
  assert.equal(JSON.stringify(gap.teaching).includes("For all have sinned"), false);
  assert.equal(JSON.stringify(gap).includes("Those whom God effectually"), false);

  const again = await plan.reserveGap({
    sourceLessonId: "l1",
    concepts: [{ conceptId: "l1-faith", conceptLabel: "Faith" }],
  });
  assert.equal(again.queued, false);
  assert.equal(again.error, undefined);
  assert.deepEqual(again.skipped, [{ conceptId: "l1-faith", reason: "covered" }]);
  assert.equal((await plan.snapshot()).plan?.lessons.length, 3);

  assert.equal(
    (
      await plan.reserveGap({
        sourceLessonId: "l1",
        concepts: [{ conceptId: "l1-hope", conceptLabel: "Hope" }],
      })
    ).queued,
    true,
  );
  assert.equal(
    (
      await plan.reserveGap({
        sourceLessonId: "l1",
        concepts: [{ conceptId: "l1-love", conceptLabel: "Love" }],
      })
    ).queued,
    true,
  );
  const capped = await plan.reserveGap({
    sourceLessonId: "l1",
    concepts: [{ conceptId: "l1-peace", conceptLabel: "Peace" }],
  });
  assert.equal(capped.queued, false);
  assert.equal(capped.error, "This lesson already has three practice lessons.");
});

test("a gap job that hits the model budget leaves the core plan usable", async () => {
  const plan = await bootPlan();
  for (let n = 0; n < BUDGET.gapLlm; n++) assert.equal(await plan.spend("llm", 1, { gap: true }), true);
  const reserved = await plan.reserveGap({
    sourceLessonId: "l1",
    concepts: [{ conceptId: "l1-faith", conceptLabel: "Faith" }],
  });
  assert.equal(reserved.queued, true);
  const env = { MOCK_AI: "1", AI: {}, LEARN_Q_CHECK: { send: async () => {} } };
  const msg = { planId: PLAN_ID, stage: "teach" as const, lessonId: reserved.lessonId!, round: 0, job: "gap" as const };
  await assert.rejects(
    () => runTeach({ env: env as never, msg, stub: plan as never }),
    (error: unknown) => error instanceof BudgetExhausted,
  );
  await plan.abandonGap(reserved.lessonId!, "The practice lesson stopped because the plan reached its model budget. The rest of the path is unchanged.");
  const snap = await plan.snapshot();
  assert.equal(snap.status, "complete");
  assert.deepEqual(snap.plan?.lessons.map((item) => item.id), ["l1", "l2"]);
  assert.equal(snap.plan?.finalAssessment[0]?.question, "Final sentinel");
  const retry = await plan.reserveGap({
    sourceLessonId: "l1",
    concepts: [{ conceptId: "l1-faith", conceptLabel: "Faith" }],
  });
  assert.equal(retry.queued, true);
});

test("practice lessons can queue while the core path is still building", async () => {
  const ctx = memoryStorage();
  const plan = new LearnPlanDO(ctx as never, {} as never);
  await plan.init({
    planId: PLAN_ID,
    userId: "user_a",
    topic: "Faith",
    notes: "",
    passages: [],
    options: { perspective: "neutral", includeScripture: "auto" },
  });
  await plan.setScope({
    title: "Faith",
    complexity: "complex",
    lessonCount: 6,
    prerequisites: [],
    coreConcepts: ["Faith"],
    objectives: ["Explain the main idea"],
    isFaithRelevant: true,
  });
  const ready = lesson("l1", 1, "The gift", "l1-faith");
  await plan.setOutline([
    {
      id: "l1",
      order: 1,
      title: "The gift",
      objectives: ["Explain the main idea"],
      prerequisiteLessonIds: [],
      estimatedMinutes: 25,
      searchHints: ["introduction"],
    },
    {
      id: "l2",
      order: 2,
      title: "The next idea",
      objectives: ["Explain the main idea"],
      prerequisiteLessonIds: ["l1"],
      estimatedMinutes: 25,
      searchHints: ["next"],
    },
  ]);
  await plan.putLesson(ready);
  const reserved = await plan.reserveGap({
    sourceLessonId: "l1",
    concepts: [{ conceptId: "l1-faith", conceptLabel: "Faith" }],
  });
  assert.equal(reserved.queued, true);
  assert.equal(reserved.lessonId, "gap-l1-1");
  const snap = await plan.snapshot();
  assert.equal(snap.status, "queued");
  assert.ok(snap.plan);
  assert.ok(snap.plan?.lessons.some((item) => item.id === "l1" && item.quiz.length > 0));
  assert.equal((await plan.snapshot()).status, "queued");
});

test("outline lessons load in one read and a poll skips lesson bodies until one is studyable", async () => {
  const ctx = memoryStorage();
  const plan = new LearnPlanDO(ctx as never, {} as never);
  await plan.init({
    planId: PLAN_ID,
    userId: "user_a",
    topic: "Faith",
    notes: "",
    passages: [],
    options: { perspective: "neutral", includeScripture: "auto" },
  });
  await plan.setScope({
    title: "Faith",
    complexity: "simple",
    lessonCount: 2,
    prerequisites: [],
    coreConcepts: ["Faith"],
    objectives: ["Explain the main idea"],
    isFaithRelevant: false,
  });
  ctx.gets.length = 0;
  const early = await plan.snapshot({ events: false });
  assert.equal(early.plan, undefined);
  assert.equal(early.events.length, 0);
  assert.equal(ctx.gets.some((key) => JSON.stringify(key).includes("lesson:")), false);
  assert.equal(ctx.gets.some((key) => Array.isArray(key) && key.includes("events")), false);

  await plan.setOutline([
    {
      id: "l1",
      order: 1,
      title: "The gift",
      objectives: ["Explain the main idea"],
      prerequisiteLessonIds: [],
      estimatedMinutes: 20,
      searchHints: [],
    },
    {
      id: "l2",
      order: 2,
      title: "The next idea",
      objectives: ["Explain the main idea"],
      prerequisiteLessonIds: ["l1"],
      estimatedMinutes: 20,
      searchHints: [],
    },
  ]);
  ctx.gets.length = 0;
  const outlined = await plan.getLessons();
  assert.deepEqual(outlined.map((item) => item.id), ["l1", "l2"]);
  const lessonReads = ctx.gets.filter((key) => JSON.stringify(key).includes("lesson:"));
  assert.equal(lessonReads.length, 1);
  assert.deepEqual(lessonReads[0], ["lesson:l1", "lesson:l2"]);

  const info = await plan.info();
  assert.deepEqual(info.lessonIds, ["l1", "l2"]);
  assert.equal(info.lessonsDone, 0);
  assert.equal(info.lessonsTotal, 2);
});

type SqlCursor = { one(): Record<string, unknown>; toArray(): Record<string, unknown>[] };

function sqliteSql(db: DatabaseSync) {
  return {
    exec(query: string, ...bindings: unknown[]): SqlCursor {
      const statement = db.prepare(query);
      const read = /^\s*(select|with)\b/i.test(query);
      const rows = (read ? statement.all(...(bindings as (string | number | null | bigint)[])) : []) as Record<string, unknown>[];
      if (!read) statement.run(...(bindings as (string | number | null | bigint)[]));
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
}

test("the workspace plan inserts the gap lesson after its parent", async () => {
  const { UserWorkspaceDO } = await import("../user-workspace-do.ts");
  const db = new DatabaseSync(":memory:");
  let ready = Promise.resolve();
  const workspace = new UserWorkspaceDO(
    {
      storage: { sql: sqliteSql(db) },
      blockConcurrencyWhile(task: () => Promise<void>) {
        ready = task();
      },
    } as never,
    {} as never,
  );
  await ready;
  const first = lesson("l1", 1, "The gift", "l1-faith");
  const second = lesson("l2", 2, "The next idea", "l2-next");
  workspace.upsertProject({
    id: "p1",
    kind: "learn",
    title: "Faith",
    blocks: [],
    updatedAt: 10,
    importComplete: true,
    learnPlan: planBody([first, second]),
  });
  const gap: LearnLesson = {
    ...lesson("gap-l1-1", 1, "Practice: Faith", "l1-faith"),
    kind: "gap",
    sourceLessonId: "l1",
    sourceConceptIds: ["l1-faith"],
    estimatedMinutes: 20,
  };
  assert.equal(workspace.mergeGapLesson(PLAN_ID, gap, 50).ok, true);
  const stored = workspace.getProject("p1");
  assert.deepEqual(stored?.learnPlan?.lessons.map((item) => item.id), ["l1", "gap-l1-1", "l2"]);
  assert.equal(stored?.learnPlan?.lessons[1]?.kind, "gap");
  assert.equal(stored?.learnProgress, undefined);

  workspace.upsertProject({
    id: "p1",
    kind: "learn",
    title: "Faith",
    blocks: [],
    updatedAt: 80,
    importComplete: true,
    learnPlan: planBody([first, second]),
    learnProgress: { v: 3 },
  });
  const kept = workspace.getProject("p1");
  assert.deepEqual(kept?.learnPlan?.lessons.map((item) => item.id), ["l1", "gap-l1-1", "l2"]);
  assert.equal(kept?.learnProgress?.v, 3);
});

async function signedRequest(path: string, userId: string, body: unknown): Promise<Request> {
  const token = await signSession(
    { userId, provider: "dev", compute: false, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  return new Request(`https://study.example${path}`, {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("the gap route rejects signed-out and non-owner callers and does not queue a duplicate concept", async () => {
  for (const key of Object.keys(workersEnv)) delete workersEnv[key];
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
  const plan = await bootPlan();
  let queued = 0;
  workersEnv.SESSION_SECRET = SECRET;
  workersEnv.AI = {};
  workersEnv.LEARN_Q_INTAKE = {};
  workersEnv.LEARN_Q_TEACH = { send: async () => { queued += 1; } };
  workersEnv.LEARN_PLAN = {
    idFromName: (id: string) => id,
    get: () => plan,
  };

  const { POST } = await import("../../../api/learn/plans/[planId]/gaps/route.ts");
  const params = { params: Promise.resolve({ planId: PLAN_ID }) };
  const body = { sourceLessonId: "l1", concepts: [{ conceptId: "l1-faith", conceptLabel: "Faith" }] };
  const signedOut = await POST(new Request(`https://study.example/api/learn/plans/${PLAN_ID}/gaps`, { method: "POST" }), params);
  assert.equal(signedOut.status, 401);
  assert.equal(queued, 0);

  const stranger = await POST(await signedRequest(`/api/learn/plans/${PLAN_ID}/gaps`, "user_b", body), params);
  assert.equal(stranger.status, 404);
  assert.equal(queued, 0);
  assert.equal((await plan.snapshot()).plan?.lessons.length, 2);

  const first = await POST(await signedRequest(`/api/learn/plans/${PLAN_ID}/gaps`, "user_a", body), params);
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as { queued?: boolean; lessonId?: string };
  assert.equal(firstBody.queued, true);
  assert.equal(firstBody.lessonId, "gap-l1-1");
  assert.equal(queued, 1);

  const second = await POST(await signedRequest(`/api/learn/plans/${PLAN_ID}/gaps`, "user_a", body), params);
  assert.equal(second.status, 200);
  const secondBody = (await second.json()) as { queued?: boolean; error?: string; skipped?: { reason: string }[] };
  assert.equal(secondBody.queued, false);
  assert.equal(secondBody.error, undefined);
  assert.equal(secondBody.skipped?.[0]?.reason, "covered");
  assert.equal(queued, 1);
});

test("the roster view does not load the plan snapshot", async () => {
  for (const key of Object.keys(workersEnv)) delete workersEnv[key];
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
  const plan = await bootPlan();
  let snapshots = 0;
  const original = plan.snapshot.bind(plan);
  plan.snapshot = async (options) => {
    snapshots += 1;
    return original(options);
  };
  workersEnv.SESSION_SECRET = SECRET;
  workersEnv.AI = {};
  workersEnv.LEARN_Q_INTAKE = {};
  workersEnv.LEARN_PLAN = {
    idFromName: (id: string) => id,
    get: () => plan,
  };
  const { GET } = await import("../../../api/learn/plans/[planId]/route.ts");
  const token = await signSession(
    { userId: "user_a", provider: "dev", compute: false, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  const response = await GET(
    new Request(`https://study.example/api/learn/plans/${PLAN_ID}?view=roster`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }),
    { params: Promise.resolve({ planId: PLAN_ID }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = (await response.json()) as { lessonIds?: string[]; lessonsDone?: number; lessonsTotal?: number; status?: string };
  assert.equal(snapshots, 0);
  assert.deepEqual(body.lessonIds, ["l1", "l2"]);
  assert.equal(body.lessonsDone, 2);
  assert.equal(body.lessonsTotal, 2);
  assert.equal(body.status, "complete");

  const full = await GET(
    new Request(`https://study.example/api/learn/plans/${PLAN_ID}?view=plan`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }),
    { params: Promise.resolve({ planId: PLAN_ID }) },
  );
  const planBody = (await full.json()) as { events?: unknown[]; plan?: { lessons?: { id: string }[] } };
  assert.equal(snapshots, 1);
  assert.deepEqual(planBody.events, []);
  assert.deepEqual(planBody.plan?.lessons?.map((item) => item.id), ["l1", "l2"]);
});

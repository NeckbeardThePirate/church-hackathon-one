import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { newConceptMastery, type ConceptMastery } from "../../learn/plan-progress.ts";
import { SESSION_COOKIE, signSession } from "../session.ts";
import { env as workersEnv } from "./cloudflare-workers-stub.ts";

/**
 * Route modules import cloudflare:workers. The test runner loads register-workers-stub.mjs,
 * which resolves that specifier to cloudflare-workers-stub.ts. Mutate `workersEnv` in place.
 */
let workspaceReads = 0;
let planRecords = 0;

const PLAN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SECRET = "route-auth-test-secret";

function installEnv(): void {
  for (const key of Object.keys(workersEnv)) delete workersEnv[key];
  workspaceReads = 0;
  planRecords = 0;
  workersEnv.SESSION_SECRET = SECRET;
  workersEnv.AI = {};
  workersEnv.LEARN_Q_INTAKE = {};
  workersEnv.LEARN_PLAN = {
    idFromName: (id: string) => id,
    get: () => ({
      info: async () => ({ userId: "someone-else" }),
      recordLearnAttempt: async () => {
        planRecords += 1;
        return {};
      },
    }),
  };
  workersEnv.USER_WORKSPACE = {
    getByName: () => {
      workspaceReads += 1;
      throw new Error("workspace should not be opened for a rejected attempt");
    },
  };
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
}

async function signedRequest(path: string, userId: string, body?: unknown): Promise<Request> {
  const token = await signSession(
    { userId, provider: "dev", compute: false, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  return new Request(`https://study.example${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("real attempt and stats routes reject a signed-out caller with 401", async () => {
  installEnv();
  const { POST } = await import("../../../api/learn/plans/[planId]/attempts/route.ts");
  const stats = await import("../../../api/workspace/stats/route.ts");
  const attempt = await POST(new Request(`https://study.example/api/learn/plans/${PLAN_ID}/attempts`, { method: "POST" }), {
    params: Promise.resolve({ planId: PLAN_ID }),
  });
  assert.equal(attempt.status, 401);
  const get = await stats.GET(new Request("https://study.example/api/workspace/stats"));
  assert.equal(get.status, 401);
  const put = await stats.PUT(
    new Request("https://study.example/api/workspace/stats", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ xp: 1 }),
    }),
  );
  assert.equal(put.status, 401);
  assert.equal(planRecords, 0);
  assert.equal(workspaceReads, 0);
});

test("the real attempt route returns 404 for a plan owned by someone else", async () => {
  installEnv();
  const { POST } = await import("../../../api/learn/plans/[planId]/attempts/route.ts");
  const request = await signedRequest(`/api/learn/plans/${PLAN_ID}/attempts`, "user_a", {
    target: "lesson",
    lessonId: "l1",
    answers: [{ mcChoice: "Faith", shortText: "", shortSubmitted: false, correct: true, conceptId: "l1-faith" }],
  });
  const response = await POST(request, { params: Promise.resolve({ planId: PLAN_ID }) });
  assert.equal(response.status, 404);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "Plan not found");
  assert.equal(planRecords, 0);
  assert.equal(workspaceReads, 0);
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

test("a project save during the attempt await keeps the newer quiz, read, and article fields", async () => {
  installEnv();
  const { UserWorkspaceDO } = await import("../user-workspace-do.ts");
  const { handleLearnAttempt } = await import("./attempt-response.ts");
  const db = new DatabaseSync(":memory:");
  let ready = Promise.resolve();
  const ctx = {
    storage: { sql: sqliteSql(db) },
    blockConcurrencyWhile(task: () => Promise<void>) {
      ready = task();
    },
  };
  const workspace = new UserWorkspaceDO(ctx as never, {} as never);
  await ready;

  const planId = "plan-1";
  const faithDefaults = newConceptMastery({ conceptId: "l1-faith", conceptLabel: "Faith", lessonId: "l1" });
  const base = {
    id: "p1",
    kind: "learn" as const,
    title: "Justification",
    blocks: [],
    importComplete: true,
    learnPlanId: planId,
    learnPlan: { id: planId, lessons: [{ id: "l1" }] },
  };
  workspace.upsertProject({
    ...base,
    updatedAt: 10,
    learnProgress: {
      v: 3,
      lessonReadScroll: { l1: 10 },
      lessonQuiz: {
        l1: {
          answers: [
            { mcChoice: "old", shortText: "", shortSubmitted: false, correct: true },
            { mcChoice: "tail", shortText: "", shortSubmitted: false, correct: false },
          ],
        },
      },
      conceptMastery: { "l1-faith": faithDefaults },
    },
  });

  const planFaith: ConceptMastery = { ...faithDefaults, easiness: 2.1, repetitions: 3, dueAt: 9999 };
  const response = await handleLearnAttempt({
    owned: { userId: "user_a" },
    now: 600,
    readBody: async () => ({
      target: "lesson",
      lessonId: "l1",
      answers: [{ mcChoice: "Faith", shortText: "", shortSubmitted: false, correct: true, conceptId: "l1-faith", conceptLabel: "Faith" }],
    }),
    previewAttempt: async (attempt) => workspace.previewLearnAttempt(planId, attempt),
    recordPlanAttempt: async () => {
      workspace.upsertProject({
        ...base,
        updatedAt: 500,
        learnProgress: {
          v: 3,
          lessonReadScroll: { l1: 88 },
          lessonReadDone: { l2: true },
          articleDone: { "https://example.com/new": true },
          lessonQuiz: {
            l1: {
              answers: [
                { mcChoice: "old", shortText: "", shortSubmitted: false, correct: true },
                { mcChoice: "tail", shortText: "", shortSubmitted: false, correct: false },
              ],
            },
            l3: { answers: [{ mcChoice: "fresh", shortText: "", shortSubmitted: false, correct: true }] },
          },
          conceptMastery: { "l1-faith": faithDefaults },
        },
      });
      return { "l1-faith": planFaith };
    },
    mirrorAttempt: async (input) => workspace.mirrorLearnAttempt(planId, input),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { conceptMastery: Record<string, ConceptMastery> };
  assert.equal(body.conceptMastery["l1-faith"]?.easiness, 2.1);
  assert.equal(body.conceptMastery["l1-faith"]?.repetitions, 3);
  assert.equal(body.conceptMastery["l1-faith"]?.dueAt, 9999);
  const stored = workspace.findProjectByLearnPlan(planId);
  assert.equal(stored?.learnProgress?.lessonReadScroll.l1, 88);
  assert.equal(stored?.learnProgress?.lessonReadDone.l2, true);
  assert.equal(stored?.learnProgress?.articleDone["https://example.com/new"], true);
  assert.equal(stored?.learnProgress?.lessonQuiz.l3?.answers[0]?.mcChoice, "fresh");
  assert.equal(stored?.learnProgress?.lessonQuiz.l1?.answers[0]?.mcChoice, "Faith");
  assert.equal(stored?.learnProgress?.lessonQuiz.l1?.answers[1]?.mcChoice, "tail");
  assert.equal(stored?.learnProgress?.conceptMastery["l1-faith"]?.easiness, 2.1);
  assert.equal(stored?.learnProgress?.conceptMastery["l1-faith"]?.repetitions, 3);
  assert.equal(stored?.learnProgress?.conceptMastery["l1-faith"]?.dueAt, 9999);
  assert.equal(stored?.updatedAt, 600);
});

test("overlapping plan attempts keep every concept and the plan's scheduling fields", async () => {
  installEnv();
  const { LearnPlanDO } = await import("./plan-do.ts");
  const data = new Map<string, unknown>();
  const faith = {
    ...newConceptMastery({ conceptId: "l1-faith", conceptLabel: "Faith", lessonId: "l1" }),
    easiness: 2.1,
    repetitions: 3,
    dueAt: 9999,
  };
  data.set("conceptMastery", { "l1-faith": faith });
  const plan = new LearnPlanDO(
    {
      storage: {
        kv: {
          get: (key: string) => data.get(key),
          put: (key: string, value: unknown) => {
            data.set(key, value);
          },
        },
        get: async (key: string) => data.get(key),
        put: async (key: string, value: unknown) => {
          data.set(key, value);
        },
        transactionSync: <T>(fn: () => T) => fn(),
      },
    } as never,
    {} as never,
  );

  const answer = (conceptId: string, conceptLabel: string) => ({
    conceptId,
    conceptLabel,
    mcChoice: conceptLabel,
    shortText: "",
    shortSubmitted: false,
    correct: true as boolean | null,
  });
  const [first, second] = await Promise.all([
    plan.recordLearnAttempt({
      at: 1,
      target: "lesson",
      lessonId: "l1",
      answers: [answer("l1-law", "Law")],
    }),
    plan.recordLearnAttempt({
      at: 2,
      target: "review",
      lessonId: "final",
      answers: [answer("final-hope", "Hope")],
    }),
  ]);
  assert.equal(first["l1-faith"]?.easiness, 2.1);
  assert.equal(second["l1-law"]?.conceptId === "l1-law" || first["l1-law"]?.conceptId === "l1-law", true);
  const stored = await plan.getConceptMastery();
  assert.equal(stored["l1-faith"]?.easiness, 2.1);
  assert.equal(stored["l1-faith"]?.repetitions, 3);
  assert.equal(stored["l1-faith"]?.dueAt, 9999);
  assert.equal(stored["l1-law"]?.easiness, 2.5);
  assert.equal(stored["l1-law"]?.repetitions, 0);
  assert.equal(stored["final-hope"]?.lessonId, "final");
  assert.equal(Object.keys(stored).sort().join(","), "final-hope,l1-faith,l1-law");
});

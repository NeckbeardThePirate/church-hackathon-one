import assert from "node:assert/strict";
import test from "node:test";
import { freshOpener, openerUserPrompt, type OpenerDiagnostic } from "../../learn/opener.ts";
import type { LearnLesson, LessonOutline, ScopeResult } from "../../learn/types.ts";
import { runResearch } from "./stages.ts";
import { LearnPlanDO } from "./plan-do.ts";
import { OPENER_SYSTEM, runOpenerAction } from "./opener-quiz.ts";
import { LEARN_MAX_TOKENS, type LlmEnv } from "./llm.ts";
import { env as workersEnv } from "./cloudflare-workers-stub.ts";

const PLAN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const SCOPE: ScopeResult = {
  title: "Romans",
  complexity: "moderate",
  lessonCount: 4,
  prerequisites: [],
  coreConcepts: ["justification by faith"],
  objectives: ["Explain justification by faith"],
  isFaithRelevant: true,
};

function memoryStorage() {
  const data = new Map<string, unknown>();
  return {
    storage: {
      get: async (key: string | string[]) => {
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
        put: (key: string, value: unknown) => data.set(key, value),
      },
    },
  };
}

function outline(id: string, order: number, title: string, objective: string): LessonOutline {
  return {
    id,
    order,
    title,
    objectives: [objective],
    prerequisiteLessonIds: order === 1 ? [] : [`l${order - 1}`],
    estimatedMinutes: 30,
    searchHints: [title],
  };
}

const OUTLINES = [
  outline("l1", 1, "Justification by faith", "Explain justification by faith"),
  outline("l2", 2, "Works of the law", "Explain works of the law"),
  outline("l3", 3, "Union with Christ", "Describe union with Christ"),
  outline("l4", 4, "Assurance", "Explain assurance"),
];

async function bootPlan(): Promise<LearnPlanDO> {
  const plan = new LearnPlanDO(memoryStorage() as never, {} as never);
  await plan.init({
    planId: PLAN_ID,
    userId: "user_a",
    topic: "Romans 3",
    notes: "I want the difference between justification and sanctification.",
    passages: [],
    options: { perspective: "neutral", includeScripture: "auto" },
  });
  await plan.setScope(SCOPE);
  return plan;
}

function mockEnv(): LlmEnv {
  return { MOCK_AI: "1", AI: {} } as LlmEnv;
}

test("answering while the outline already exists adds a gap lesson and leaves the plan running", async () => {
  const plan = await bootPlan();
  await plan.setOutline(OUTLINES);
  const env = mockEnv();

  const opened = await runOpenerAction(env, plan, { type: "next" });
  assert.equal(opened.body.status, "asking");
  assert.equal(opened.steer.researchIds.length, 0);
  const question = opened.body.question;
  assert.ok(question);

  const answered = await runOpenerAction(env, plan, { type: "answer", questionId: question.id, choiceId: "b" });
  assert.equal(answered.body.status, "asking");
  assert.equal(answered.steer.researchIds.length, 1);
  const info = await plan.info();
  assert.equal(info.status, "queued");
  assert.equal(info.lessonIds.includes("l1"), true);
  assert.equal(info.lessonIds.includes(answered.steer.researchIds[0]!), true);
  const added = await plan.getLesson(answered.steer.researchIds[0]!);
  assert.match(added?.title ?? "", /main idea/i);
  assert.equal(added?.status, "pending");

  const again = await plan.steerFromOpener();
  assert.deepEqual(again.researchIds, []);
  assert.deepEqual((await plan.info()).lessonIds, info.lessonIds);
});

test("commitOutline folds a diagnostic in before research is queued", async () => {
  const plan = await bootPlan();
  await plan.saveOpener({
    ...freshOpener(),
    diagnostic: { strengths: ["justification by faith"], gaps: ["adoption"] } satisfies OpenerDiagnostic,
  });
  const committed = await plan.commitOutline(OUTLINES);
  assert.equal(committed.researchIds.includes("l1"), false);
  assert.match(committed.summary, /Adoption/);
  assert.match(committed.note, /Justification by faith/);
  const info = await plan.info();
  assert.equal(info.lessonIds.includes("l1"), false);
  assert.equal(info.lessonsTotal, committed.researchIds.length);
  assert.equal(info.lessonsDone, 0);
  assert.equal(info.status, "queued");
});

test("a started lesson is kept when a later answer arrives", async () => {
  const plan = await bootPlan();
  await plan.setOutline(OUTLINES);
  const started: LearnLesson = {
    ...(await plan.getLesson("l1"))!,
    status: "ok",
    teaching: [{ type: "paragraph", text: "Justification is God's gift." }],
  };
  await plan.putLesson(started);
  await plan.saveOpener({
    ...freshOpener(),
    diagnostic: { strengths: ["justification by faith"], gaps: ["adoption"] },
  });
  const steered = await plan.steerFromOpener();
  const info = await plan.info();
  assert.equal(info.lessonIds[0], "l1");
  assert.equal(info.status, "queued");
  assert.equal((await plan.getLesson("l1"))?.status, "ok");
  assert.match((await plan.getLesson(steered.researchIds[0] ?? ""))?.title ?? "", /Adoption/);
});

test("skip and a timed-out Haiku call finish the check without failing the path", async () => {
  const plan = await bootPlan();
  await plan.setOutline(OUTLINES);
  const skipped = await runOpenerAction(mockEnv(), plan, { type: "skip" });
  assert.equal(skipped.body.status, "closed");
  assert.equal(skipped.body.reason, "skipped");
  const afterSkip = await runOpenerAction(mockEnv(), plan, { type: "next" });
  assert.equal(afterSkip.body.status, "closed");
  assert.equal(afterSkip.body.reason, "skipped");
  assert.equal((await plan.info()).status, "queued");
  assert.deepEqual((await plan.info()).lessonIds, ["l1", "l2", "l3", "l4"]);

  const slow = await bootPlan();
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI: {
      gateway() {
        return {
          async run() {
            await new Promise((resolve) => setTimeout(resolve, 200));
            throw new Error("late gateway failure");
          },
        };
      },
    },
  } as unknown as LlmEnv;
  const timed = await runOpenerAction(env, slow, { type: "next" }, { timeoutMs: 40 });
  assert.equal(timed.body.status, "closed");
  assert.equal(timed.body.reason, "unavailable");
  const snap = await slow.snapshot({ events: false, workingPlan: false });
  assert.equal(snap.status, "queued");
  assert.equal(snap.error, undefined);

  const again = await runOpenerAction(mockEnv(), slow, { type: "next" });
  assert.equal(again.body.status, "asking");
  assert.ok(again.body.question?.prompt);
});

const OPENER_QUESTION = {
  prompt: "How familiar is justification by faith?",
  probe: "justification by faith",
  stop: false,
  choices: [
    { id: "a", label: "I can explain it", reading: "strength", concept: "justification by faith" },
    { id: "b", label: "I mix it up with sanctification", reading: "gap", concept: "justification by faith" },
    { id: "c", label: "I know the phrase only", reading: "gap", concept: "sanctification" },
    { id: "d", label: "I'm not sure yet", reading: "unsure", concept: "justification by faith" },
  ],
};

function questionResponse(): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(OPENER_QUESTION) }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("the opener call uses the Haiku catalog id through the gateway", async () => {
  const plan = await bootPlan();
  let sentQuery: Record<string, unknown> | undefined;
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI: {
      gateway(id: string) {
        assert.equal(id, "study-buddy");
        return {
          async run(request: { query?: Record<string, unknown> }) {
            sentQuery = request.query;
            return questionResponse();
          },
        };
      },
    },
  } as unknown as LlmEnv;

  const opened = await runOpenerAction(env, plan, { type: "next" });
  assert.deepEqual(sentQuery, {
    model: "claude-haiku-5-5",
    max_tokens: LEARN_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: `${OPENER_SYSTEM}\nReturn ONLY one JSON object. No prose, no code fences.`,
    messages: [
      {
        role: "user",
        content: openerUserPrompt({
          topic: "Romans 3",
          notes: "I want the difference between justification and sanctification.",
          passages: [],
          questions: [],
          answers: [],
        }),
      },
    ],
  });
  assert.equal(opened.body.status, "asking");
  assert.equal(opened.body.question?.prompt, "How familiar is justification by faith?");
  assert.equal((await plan.info()).status, "queued");
});

test("a gateway 4xx falls back once without output_config", async () => {
  const plan = await bootPlan();
  const sent: Record<string, unknown>[] = [];
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI: {
      gateway() {
        return {
          async run(request: { query?: Record<string, unknown> }) {
            sent.push(request.query ?? {});
            if (sent.length === 1) {
              return new Response(JSON.stringify({ error: { message: "output_config.effort is not allowed on this request" } }), {
                status: 400,
                headers: { "content-type": "application/json" },
              });
            }
            return questionResponse();
          },
        };
      },
    },
  } as unknown as LlmEnv;

  const opened = await runOpenerAction(env, plan, { type: "next" });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0]?.thinking, { type: "adaptive" });
  assert.deepEqual(sent[0]?.output_config, { effort: "low" });
  assert.equal(sent[0]?.max_tokens, LEARN_MAX_TOKENS);
  assert.deepEqual(sent[1]?.thinking, { type: "adaptive" });
  assert.equal("output_config" in (sent[1] ?? {}), false);
  assert.equal(opened.body.status, "asking");
  assert.equal(opened.body.question?.prompt, "How familiar is justification by faith?");
});

test("a retired lesson leaves research without enqueueing the next stage", async () => {
  const plan = await bootPlan();
  await plan.setOutline(OUTLINES);
  await plan.putScratch("opener-skip:l1", true);
  const sent: string[] = [];
  await runResearch({
    env: {
      MOCK_AI: "1",
      AI: {},
      LEARN_Q_REVIEW: { send: async () => sent.push("review") },
      LEARN_Q_TEACH: { send: async () => sent.push("teach") },
      LEARN_Q_CRITIC: { send: async () => sent.push("critic") },
    } as never,
    msg: { planId: PLAN_ID, stage: "research", lessonId: "l1", round: 0 },
    stub: plan as never,
  });
  assert.deepEqual(sent, []);
  const info = await plan.info();
  assert.equal(info.status, "queued");
  assert.equal(info.lessonsDone, 1);
  assert.equal(info.lessonsTotal, 4);
});

test("the opener route rejects a signed-out caller", async () => {
  for (const key of Object.keys(workersEnv)) delete workersEnv[key];
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
  const { GET, POST } = await import("../../../api/learn/plans/[planId]/opener/route.ts");
  const params = { params: Promise.resolve({ planId: PLAN_ID }) };
  const get = await GET(new Request(`https://study.example/api/learn/plans/${PLAN_ID}/opener`), params);
  const post = await POST(new Request(`https://study.example/api/learn/plans/${PLAN_ID}/opener`, { method: "POST" }), params);
  assert.equal(get.status, 401);
  assert.equal(post.status, 401);
});

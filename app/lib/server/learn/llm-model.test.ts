import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkersAiText } from "../ocr.ts";
import { extractJson } from "./json-text.ts";
import { LEARN_TEXT_MODEL, anthropicProviderModel, learnModelId, llmJson, type LlmEnv } from "./llm.ts";

test("empty Learn model vars default to Claude Haiku 5.5", () => {
  assert.equal(LEARN_TEXT_MODEL, "anthropic/claude-haiku-5.5");
  assert.equal(learnModelId({}, "planner"), LEARN_TEXT_MODEL);
  assert.equal(learnModelId({}, "worker"), LEARN_TEXT_MODEL);
  assert.equal(learnModelId({ LEARN_MODEL_PLANNER: "  ", LEARN_MODEL_WORKER: "" }, "planner"), LEARN_TEXT_MODEL);
  assert.equal(learnModelId({ LEARN_MODEL_WORKER: "\n" }, "worker"), LEARN_TEXT_MODEL);
});

test("Learn model vars override the Haiku default per role", () => {
  assert.equal(
    learnModelId({ LEARN_MODEL_PLANNER: " anthropic/claude-sonnet-5.5 " }, "planner"),
    "anthropic/claude-sonnet-5.5",
  );
  assert.equal(learnModelId({ LEARN_MODEL_PLANNER: "anthropic/claude-sonnet-5.5" }, "worker"), LEARN_TEXT_MODEL);
  assert.equal(learnModelId({ LEARN_MODEL_WORKER: "@cf/example/model" }, "worker"), "@cf/example/model");
});

test("Haiku catalog id maps to the Anthropic messages model name", () => {
  assert.equal(anthropicProviderModel("anthropic/claude-haiku-5.5"), "claude-haiku-5-5");
  assert.equal(anthropicProviderModel("anthropic/claude-opus-4.8"), "claude-opus-4-8");
  assert.equal(anthropicProviderModel("anthropic/claude-haiku-5-5"), "claude-haiku-5-5");
});

test("Haiku message text skips thinking blocks and fenced JSON still parses", () => {
  const raw = parseWorkersAiText({
    content: [
      { type: "thinking", thinking: '{"bad":true}' },
      { type: "text", text: 'Sure:\n```json\n{"scope":"faith"}\n```\nNote {1}' },
    ],
  });
  assert.equal(raw.includes("bad"), false);
  assert.deepEqual(extractJson(raw), { scope: "faith" });
});

test("scope JSON accepts a fenced Haiku gateway response", async () => {
  let sentModel = "";
  let sentAuth = false;
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI_GATEWAY_TOKEN: "gateway-token",
    AI: {
      gateway(id: string) {
        assert.equal(id, "study-buddy");
        return {
          async run(request: { headers: Record<string, string>; query: { model?: string } }) {
            sentModel = request.query.model ?? "";
            sentAuth = request.headers["cf-aig-authorization"] === "Bearer gateway-token";
            return new Response(
              JSON.stringify({
                content: [
                  { type: "thinking", thinking: '{"bad":true}' },
                  { type: "text", text: '```json\n{"topic":"prayer"}\n```' },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          },
        };
      },
    },
  } as unknown as LlmEnv;

  const value = await llmJson(env, {
    role: "planner",
    system: "Return scope JSON.",
    user: "How to pray the Psalms",
    meta: { planId: "plan-1", stage: "scope" },
    validate: (raw) => {
      const record = raw as { topic?: string };
      if (record.topic !== "prayer") throw new Error("topic mismatch");
      return record;
    },
  });

  assert.equal(value.topic, "prayer");
  assert.equal(sentModel, "claude-haiku-5-5");
  assert.equal(sentAuth, true);
});

test("a thinking-only Haiku answer names the stop reason", async () => {
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI: {
      gateway() {
        return {
          async run() {
            return new Response(
              JSON.stringify({
                stop_reason: "max_tokens",
                content: [{ type: "thinking", thinking: "The learner may already know this." }],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          },
        };
      },
    },
  } as unknown as LlmEnv;

  await assert.rejects(
    () =>
      llmJson(env, {
        role: "worker",
        model: LEARN_TEXT_MODEL,
        system: "Return one question.",
        user: "John 3",
        meta: { planId: "plan-1", stage: "opener" },
        maxTokens: 800,
        validate: () => ({}),
      }),
    /stop_reason: max_tokens/,
  );
});

test("Workers AI JSON calls forward the gateway and fall back on auth errors", async () => {
  const calls: unknown[] = [];
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    LEARN_MODEL_PLANNER: "@cf/example/model",
    AI: {
      async run(_model: string, _input: unknown, options?: unknown) {
        calls.push(options);
        if (calls.length === 1) throw new Error("401 cf-aig unauthorized");
        return { response: '{"topic":"prayer"}' };
      },
    },
  } as unknown as LlmEnv;

  const value = await llmJson(env, {
    role: "planner",
    system: "Return scope JSON.",
    user: "How to pray the Psalms",
    meta: { planId: "plan-1", stage: "scope" },
    validate: (raw) => {
      const record = raw as { topic?: string };
      if (record.topic !== "prayer") throw new Error("topic mismatch");
      return record;
    },
  });

  assert.equal(value.topic, "prayer");
  assert.deepEqual(calls[0], {
    gateway: {
      id: "study-buddy",
      skipCache: false,
      metadata: { planId: "plan-1", stage: "scope", lessonId: null, attempt: 1 },
    },
  });
  assert.equal(calls[1], undefined);
  assert.equal(calls.length, 2);
});

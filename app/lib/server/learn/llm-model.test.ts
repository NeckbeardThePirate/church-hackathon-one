import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkersAiText } from "../ocr.ts";
import { extractJson } from "./json-text.ts";
import {
  LEARN_GATEWAY_TIMEOUT_MS,
  LEARN_MAX_TOKENS,
  LEARN_MAX_TOKENS_LIMIT,
  LEARN_MAX_TOKENS_LONG,
  LEARN_TEXT_MODEL,
  anthropicProviderModel,
  anthropicRequestQuery,
  learnModelId,
  llmJson,
  readAnthropicText,
  resolveMaxTokens,
  warnIfMaxTokensStop,
  type LlmEnv,
} from "./llm.ts";

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
  let sentProvider = "";
  let sentEndpoint = "";
  let sentMaxTokens = 0;
  let sentThinking: unknown;
  let sentEffort: unknown;
  let sentTimeout = "";
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI_GATEWAY_TOKEN: "gateway-token",
    AI: {
      gateway(id: string) {
        assert.equal(id, "study-buddy");
        return {
          async run(request: {
            provider?: string;
            endpoint?: string;
            headers: Record<string, string>;
            query: { model?: string; max_tokens?: number; thinking?: unknown; output_config?: { effort?: unknown }; temperature?: unknown };
          }) {
            sentProvider = request.provider ?? "";
            sentEndpoint = request.endpoint ?? "";
            sentModel = request.query.model ?? "";
            sentMaxTokens = request.query.max_tokens ?? 0;
            sentThinking = request.query.thinking;
            sentEffort = request.query.output_config?.effort;
            sentTimeout = request.headers["cf-aig-request-timeout"] ?? "";
            sentAuth = request.headers["cf-aig-authorization"] === "Bearer gateway-token";
            assert.equal(request.query.temperature, undefined);
            return new Response(
              JSON.stringify({
                content: [
                  { type: "thinking", thinking: '{"bad":true}' },
                  { type: "text", text: '```json\n{"topic":"prayer"}\n```' },
                ],
                stop_reason: "end_turn",
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
  assert.equal(sentProvider, "anthropic");
  assert.equal(sentEndpoint, "v1/messages");
  assert.equal(sentModel, "claude-haiku-5-5");
  assert.equal(sentAuth, true);
  assert.equal(sentMaxTokens, LEARN_MAX_TOKENS);
  assert.deepEqual(sentThinking, { type: "adaptive" });
  assert.equal(sentEffort, "low");
  assert.equal(sentTimeout, String(LEARN_GATEWAY_TIMEOUT_MS));
});

test("token budgets stay inside the Haiku 5.5 output cap", () => {
  assert.equal(LEARN_MAX_TOKENS, 8_000);
  assert.equal(LEARN_MAX_TOKENS_LONG, 16_000);
  assert.equal(LEARN_MAX_TOKENS_LIMIT, 128_000);
  assert.equal(LEARN_GATEWAY_TIMEOUT_MS, 240_000);
  assert.equal(resolveMaxTokens(undefined), LEARN_MAX_TOKENS);
  assert.equal(resolveMaxTokens(200), LEARN_MAX_TOKENS);
  assert.equal(resolveMaxTokens(LEARN_MAX_TOKENS_LONG), LEARN_MAX_TOKENS_LONG);
  assert.equal(resolveMaxTokens(500_000), LEARN_MAX_TOKENS_LIMIT);
  const query = anthropicRequestQuery({ max_tokens: LEARN_MAX_TOKENS_LONG, temperature: 0.4, messages: [] });
  assert.equal(query.max_tokens, LEARN_MAX_TOKENS_LONG);
  assert.equal("temperature" in query, false);
  assert.deepEqual(query.thinking, { type: "adaptive" });
  assert.deepEqual(anthropicRequestQuery({ thinking: { type: "disabled" }, messages: [] }).thinking, { type: "disabled" });
  assert.deepEqual(query.output_config, { effort: "low" });
  assert.deepEqual(query.messages, []);
});

test("a too-small maxTokens is raised before the Haiku request", async () => {
  let sentMaxTokens = 0;
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI: {
      gateway() {
        return {
          async run(request: { query: { max_tokens?: number } }) {
            sentMaxTokens = request.query.max_tokens ?? 0;
            return { content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn" };
          },
        };
      },
    },
  } as unknown as LlmEnv;

  const value = await llmJson(env, {
    role: "worker",
    system: "Return JSON.",
    user: "ping",
    meta: { planId: "plan-1", stage: "grade" },
    maxTokens: 200,
    validate: (raw) => raw as { ok: boolean },
  });

  assert.equal(value.ok, true);
  assert.equal(sentMaxTokens, LEARN_MAX_TOKENS);
});

test("max_tokens stop is logged, and Workers AI inherits the token floor", async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const text = await readAnthropicText(
      {
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '{"ok":true}' }],
      },
      "teach",
    );
    assert.equal(text, '{"ok":true}');
    assert.equal(
      warnings.some((line) => line.includes("teach") && line.includes("stop_reason=max_tokens")),
      true,
    );

    const beforeEndTurn = warnings.length;
    await readAnthropicText({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] }, "scope");
    assert.equal(warnings.length, beforeEndTurn);

    warnIfMaxTokensStop({ type: "message_delta", delta: { stop_reason: "max_tokens" } }, "tutor");
    assert.equal(
      warnings.some((line) => line.includes("tutor") && line.includes("stop_reason=max_tokens")),
      true,
    );

    await assert.rejects(
      () =>
        readAnthropicText(
          { stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "only thought" }] },
          "grade",
        ),
      /stop_reason: max_tokens/,
    );

    let sent: Record<string, unknown> = {};
    const env = {
      LEARN_MODEL_WORKER: "@cf/example/model",
      AI: {
        async run(_model: string, input: Record<string, unknown>) {
          sent = input;
          return { response: '{"ok":true}', stop_reason: "max_tokens" };
        },
      },
    } as unknown as LlmEnv;
    const value = await llmJson(env, {
      role: "worker",
      system: "Return JSON.",
      user: "ping",
      meta: { planId: "plan-1", stage: "check" },
      maxTokens: 100,
      validate: (raw) => raw as { ok: boolean },
    });
    assert.equal(value.ok, true);
    assert.equal(sent.max_tokens, LEARN_MAX_TOKENS);
    assert.equal(sent.reasoning_effort, "low");
    assert.equal(
      warnings.some((line) => line.includes("workers-ai check") && line.includes("stop_reason=max_tokens")),
      true,
    );
  } finally {
    console.warn = original;
  }
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

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

import assert from "node:assert/strict";
import test from "node:test";
import type { LearnChatInput } from "../learn/agent-context.ts";
import { streamLearnChat } from "./learn-chat.ts";

const WORKERS_MODEL = "@cf/example/model";

function chatInput(): LearnChatInput {
  return {
    context: {
      planId: "plan-1",
      topic: "prayer",
      title: "Prayer",
      perspective: "neutral",
      complexity: "simple",
      objectives: [],
      prerequisites: [],
      focus: { screen: "overview" },
    },
    messages: [{ role: "user", content: "What is prayer?" }],
  };
}

type ChatEnv = Parameters<typeof streamLearnChat>[0];

type RunCall = { model: string; input: { stream?: boolean; temperature?: number; messages?: { content?: string }[] }; options: unknown };

function workersAi(onRun: (index: number) => unknown) {
  const calls: RunCall[] = [];
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    LEARN_MODEL_WORKER: WORKERS_MODEL,
    AI: {
      async run(model: string, input: RunCall["input"], options?: unknown) {
        calls.push({ model, input, options });
        return onRun(calls.length - 1);
      },
    },
  } as unknown as ChatEnv;
  return { env, calls };
}

function sse(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: text })}\n\n`));
      controller.close();
    },
  });
}

test("Workers AI chat forwards the gateway id and chat stage", async () => {
  const { env, calls } = workersAi(() => sse("A conversation with God."));
  const text = await new Response(await streamLearnChat(env, chatInput())).text();

  assert.equal(text, "A conversation with God.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, WORKERS_MODEL);
  assert.equal(calls[0]!.input.stream, true);
  assert.equal(calls[0]!.input.temperature, 0.45);
  assert.equal(calls[0]!.input.messages?.at(-1)?.content, "What is prayer?");
  assert.deepEqual(calls[0]!.options, {
    gateway: { id: "study-buddy", metadata: { stage: "chat" } },
  });
});

test("Workers AI chat falls back to a direct call on gateway auth errors", async () => {
  const { env, calls } = workersAi((index) => {
    if (index === 0) throw new Error("403 cf-aig authentication failed");
    return sse("Try again without the gateway.");
  });

  const text = await new Response(await streamLearnChat(env, chatInput())).text();

  assert.equal(text, "Try again without the gateway.");
  assert.deepEqual(calls[0]!.options, {
    gateway: { id: "study-buddy", metadata: { stage: "chat" } },
  });
  assert.equal(calls[1]!.options, undefined);
  assert.equal(calls[1]!.model, WORKERS_MODEL);
  assert.equal(calls.length, 2);
});

test("Workers AI chat does not retry other model errors and skips an unset gateway", async () => {
  const failed = workersAi(() => {
    throw new Error("model overloaded");
  });
  await assert.rejects(() => streamLearnChat(failed.env, chatInput()), /model overloaded/);
  assert.equal(failed.calls.length, 1);

  const calls: unknown[] = [];
  const env = {
    LEARN_MODEL_WORKER: WORKERS_MODEL,
    AI: {
      async run(_model: string, _input: unknown, options?: unknown) {
        calls.push(options);
        return sse("direct");
      },
    },
  } as unknown as ChatEnv;
  assert.equal(await new Response(await streamLearnChat(env, chatInput())).text(), "direct");
  assert.deepEqual(calls, [undefined]);
});

test("Anthropic chat still uses the gateway provider instead of Workers AI.run", async () => {
  let ran = false;
  let gatewayId = "";
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI: {
      async run() {
        ran = true;
        throw new Error("Workers AI.run should not be used for Anthropic");
      },
      gateway(id: string) {
        gatewayId = id;
        return {
          async run() {
            return new Response(
              `data: ${JSON.stringify({
                type: "content_block_delta",
                delta: { type: "text_delta", text: "Haiku" },
              })}\n\n`,
              { status: 200 },
            );
          },
        };
      },
    },
  } as unknown as ChatEnv;

  const text = await new Response(await streamLearnChat(env, chatInput())).text();
  assert.equal(text, "Haiku");
  assert.equal(ran, false);
  assert.equal(gatewayId, "study-buddy");
});

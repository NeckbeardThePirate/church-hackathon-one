import assert from "node:assert/strict";
import test from "node:test";
import { EMBED_MODEL, embedTexts, embedVersePage } from "./scripture-search.ts";

type RunCall = { model: string; input: { text?: string[] }; options: unknown };

function recordingAi(onRun: (index: number) => unknown) {
  const calls: RunCall[] = [];
  const ai = {
    async run(model: string, input: { text?: string[] }, options?: unknown) {
      calls.push({ model, input, options });
      return onRun(calls.length - 1);
    },
  };
  return { ai: ai as unknown as Ai, calls };
}

test("embeddings forward the gateway id and embed stage", async () => {
  const { ai, calls } = recordingAi(() => ({ data: [[0.1, 0.2]] }));
  const vectors = await embedTexts({ AI: ai, AI_GATEWAY_ID: "study-buddy" }, ["In the beginning"]);

  assert.deepEqual(vectors, [[0.1, 0.2]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, EMBED_MODEL);
  assert.deepEqual(calls[0]!.input.text, ["In the beginning"]);
  assert.deepEqual(calls[0]!.options, {
    gateway: { id: "study-buddy", metadata: { stage: "embed" } },
  });
});

test("embeddings fall back to a direct Workers AI call on gateway auth errors", async () => {
  const { ai, calls } = recordingAi((index) => {
    if (index === 0) throw new Error("401 Unauthorized");
    return { data: [[0.4, 0.5]] };
  });

  const vectors = await embedTexts({ AI: ai, AI_GATEWAY_ID: "study-buddy" }, ["faith"]);

  assert.deepEqual(vectors, [[0.4, 0.5]]);
  assert.deepEqual(calls[0]!.options, {
    gateway: { id: "study-buddy", metadata: { stage: "embed" } },
  });
  assert.equal(calls[1]!.options, undefined);
  assert.deepEqual(calls[1]!.input.text, ["faith"]);
  assert.equal(calls.length, 2);
});

test("embeddings do not retry other errors and skip an unset gateway", async () => {
  const failed = recordingAi(() => {
    throw new Error("model overloaded");
  });
  await assert.rejects(
    () => embedTexts({ AI: failed.ai, AI_GATEWAY_ID: "study-buddy" }, ["faith"]),
    /model overloaded/,
  );
  assert.equal(failed.calls.length, 1);

  const direct = recordingAi(() => ({ data: [[1]] }));
  assert.deepEqual(await embedTexts({ AI: direct.ai }, ["faith"]), [[1]]);
  assert.equal(direct.calls[0]!.options, undefined);
});

test("verse embedding pages pass the gateway id through", async () => {
  const options: unknown[] = [];
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI: {
      async run(_model: string, _input: unknown, gateway?: unknown) {
        options.push(gateway);
        return { data: [[0.1, 0.2]] };
      },
    },
    BIBLE: {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [{ rowid: 3, book_id: 1, chapter: 1, verse: 1, text: "In the beginning" }],
                };
              },
            };
          },
        };
      },
    },
    SCRIPTURE_VECTORS: {
      async upsert() {},
    },
  };

  const page = await embedVersePage(env as unknown as Parameters<typeof embedVersePage>[0], 0, 10);

  assert.equal(page.processed, 1);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(options, [{ gateway: { id: "study-buddy", metadata: { stage: "embed" } } }]);
});

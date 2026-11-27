import assert from "node:assert/strict";
import test from "node:test";
import { isGatewayAuthError } from "./ai-gateway.ts";
import { OCR_MODEL, runImageOcr, runImageOcrFromBytes } from "./ocr.ts";

const IMAGE = "data:image/png;base64,YQ==";

type RunCall = { model: string; input: { image?: string }; options: unknown };

function recordingAi(handlers: {
  onRun: (call: RunCall, index: number) => unknown;
}) {
  const calls: RunCall[] = [];
  const ai = {
    async run(model: string, input: { image?: string }, options?: unknown) {
      const call = { model, input, options };
      calls.push(call);
      return handlers.onRun(call, calls.length - 1);
    },
  };
  return { ai: ai as unknown as Ai, calls };
}

test("gateway auth errors match the Learn client matcher", () => {
  assert.equal(isGatewayAuthError(new Error("401 Unauthorized")), true);
  assert.equal(isGatewayAuthError(new Error("403 Forbidden")), true);
  assert.equal(isGatewayAuthError("cf-aig authentication failed"), true);
  assert.equal(isGatewayAuthError(new Error("model overloaded")), false);
});

test("OCR forwards the gateway id and ocr stage", async () => {
  const { ai, calls } = recordingAi({
    onRun: () => ({ response: "In the beginning" }),
  });

  const text = await runImageOcr({ AI: ai, AI_GATEWAY_ID: "study-buddy" }, IMAGE);

  assert.equal(text, "In the beginning");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, OCR_MODEL);
  assert.equal(calls[0]!.input.image, IMAGE);
  assert.deepEqual(calls[0]!.options, {
    gateway: { id: "study-buddy", metadata: { stage: "ocr" } },
  });
});

test("OCR from photo bytes uses the same gateway options", async () => {
  const { ai, calls } = recordingAi({
    onRun: () => ({ response: "Genesis 1:1" }),
  });

  const text = await runImageOcrFromBytes(
    { AI: ai, AI_GATEWAY_ID: "study-buddy" },
    new Uint8Array([1, 2, 3]),
    "image/jpeg",
  );

  assert.equal(text, "Genesis 1:1");
  assert.equal(calls[0]!.model, OCR_MODEL);
  assert.match(calls[0]!.input.image ?? "", /^data:image\/jpeg;base64,/);
  assert.deepEqual(calls[0]!.options, {
    gateway: { id: "study-buddy", metadata: { stage: "ocr" } },
  });
});

test("OCR retries on Workers AI directly when the gateway rejects auth", async () => {
  const { ai, calls } = recordingAi({
    onRun: (_call, index) => {
      if (index === 0) throw new Error("401 cf-aig unauthorized");
      return { response: "John 1:1" };
    },
  });

  const text = await runImageOcr({ AI: ai, AI_GATEWAY_ID: "study-buddy" }, IMAGE);

  assert.equal(text, "John 1:1");
  assert.deepEqual(calls[0]!.options, {
    gateway: { id: "study-buddy", metadata: { stage: "ocr" } },
  });
  assert.equal(calls[1]!.options, undefined);
  assert.equal(calls[1]!.input.image, IMAGE);
  assert.equal(calls.length, 2);
});

test("OCR does not retry a direct call that also fails gateway auth", async () => {
  const { ai, calls } = recordingAi({
    onRun: () => {
      throw new Error("403 Forbidden");
    },
  });

  await assert.rejects(
    () => runImageOcr({ AI: ai, AI_GATEWAY_ID: "study-buddy" }, IMAGE),
    /403 Forbidden/,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.options, undefined);
});

test("OCR does not retry model errors and skips the gateway when no id is set", async () => {
  const denied = recordingAi({
    onRun: () => {
      throw new Error("model overloaded");
    },
  });
  await assert.rejects(
    () => runImageOcr({ AI: denied.ai, AI_GATEWAY_ID: "study-buddy" }, IMAGE),
    /model overloaded/,
  );
  assert.equal(denied.calls.length, 1);
  assert.deepEqual(denied.calls[0]!.options, {
    gateway: { id: "study-buddy", metadata: { stage: "ocr" } },
  });

  const direct = recordingAi({
    onRun: () => ({ response: "typed by hand" }),
  });
  const text = await runImageOcr({ AI: direct.ai }, IMAGE);
  assert.equal(text, "typed by hand");
  assert.equal(direct.calls.length, 1);
  assert.equal(direct.calls[0]!.options, undefined);

  const blank = recordingAi({
    onRun: () => ({ response: "still direct" }),
  });
  assert.equal(await runImageOcr({ AI: blank.ai, AI_GATEWAY_ID: "" }, IMAGE), "still direct");
  assert.equal(blank.calls[0]!.options, undefined);
});

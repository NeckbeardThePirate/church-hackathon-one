import assert from "node:assert/strict";
import test from "node:test";
import { extractJson } from "./json-text.ts";

test("extractJson reads an object wrapped in prose or fences", () => {
  assert.deepEqual(extractJson('Sure:\n```json\n{"ok":true}\n```'), { ok: true });
});

test("extractJson rejects text with no object", () => {
  assert.throws(() => extractJson("no json here"), /No JSON object/);
});

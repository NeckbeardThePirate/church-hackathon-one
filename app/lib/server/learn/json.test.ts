import assert from "node:assert/strict";
import test from "node:test";
import { extractJson } from "./json-text.ts";

test("extractJson reads an object wrapped in prose or fences", () => {
  assert.deepEqual(extractJson('Sure:\n```json\n{"ok":true}\n```'), { ok: true });
});

test("extractJson rejects text with no object", () => {
  assert.throws(() => extractJson("no json here"), /No JSON object/);
});

test("extractJson prefers a fenced object over a later brace", () => {
  assert.deepEqual(extractJson('```json\n{"ok":true}\n```\nSee {not json}'), { ok: true });
});

test("extractJson skips a non-json brace then reads the object", () => {
  assert.deepEqual(extractJson('prefix {not} {"ok":true}'), { ok: true });
});

import assert from "node:assert/strict";
import test from "node:test";
import { openSourceQueryOrder } from "./open-sources.ts";

test("open-source search tries the topic before vague lesson hints", () => {
  const queries = openSourceQueryOrder("Justification by faith", "The heart of the topic", ["introduction", "primary text"]);
  assert.deepEqual(queries, ["Justification by faith", "The heart of the topic", "introduction", "primary text"]);
});

test("open-source search drops blanks and duplicates", () => {
  assert.deepEqual(openSourceQueryOrder("  Grace  ", "Grace", ["", "grace"]), ["Grace", "grace"]);
});

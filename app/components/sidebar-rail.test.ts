import assert from "node:assert/strict";
import test from "node:test";
import { sidebarRailClass } from "./sidebar-rail.ts";

test("the collapsed rail does not also carry the expanded width", () => {
  const collapsed = sidebarRailClass(true);
  const expanded = sidebarRailClass(false);

  assert.match(collapsed, /md:w-16\b/);
  assert.match(collapsed, /md:max-w-16\b/);
  assert.doesNotMatch(collapsed, /md:w-60\b/);
  assert.doesNotMatch(collapsed, /md:min-w-60\b/);
  assert.doesNotMatch(collapsed, /md:px-3\b/);

  assert.match(expanded, /md:w-60\b/);
  assert.match(expanded, /md:min-w-60\b/);
  assert.match(expanded, /md:px-3\b/);
  assert.doesNotMatch(expanded, /md:w-16\b/);
  assert.doesNotMatch(expanded, /md:max-w-16\b/);
  assert.doesNotMatch(expanded, /md:px-0\b/);
});

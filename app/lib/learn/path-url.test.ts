import assert from "node:assert/strict";
import test from "node:test";
import { locationForPlan, parsePathUrl, pathSearch } from "./path-url.ts";

test("a path and lesson round-trip through the query string", () => {
  const search = pathSearch("path_1", { screen: "lesson", lessonId: "l2" });
  assert.equal(search, "?path=path_1&lesson=l2");
  assert.deepEqual(parsePathUrl(search), { pathId: "path_1", location: { screen: "lesson", lessonId: "l2" } });
  assert.equal(pathSearch("path_1", { screen: "final" }), "?path=path_1&lesson=final");
  assert.equal(pathSearch("path_1", { screen: "overview" }), "?path=path_1&lesson=home");
  assert.equal(pathSearch(null, null, search), "");
});

test("a missing lesson param does not invent a screen, and a bad id is ignored", () => {
  assert.deepEqual(parsePathUrl("?path=abc"), { pathId: "abc", location: null });
  assert.deepEqual(parsePathUrl("?path=has space&lesson=../x"), { pathId: null, location: null });
});

test("a lesson id that is not on the plan opens the course home", () => {
  assert.deepEqual(locationForPlan({ screen: "lesson", lessonId: "gone" }, ["l1"]), { screen: "overview" });
  assert.deepEqual(locationForPlan({ screen: "lesson", lessonId: "l1" }, ["l1"]), {
    screen: "lesson",
    lessonId: "l1",
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { combineReadPercent, scrollDepthPercent, sectionVisibilityPercent } from "./read-progress.ts";

test("scroll depth is 0 at the top, 100 at the bottom, and 100 when the lesson fits", () => {
  assert.equal(scrollDepthPercent(0, 1000, 200), 0);
  assert.equal(scrollDepthPercent(800, 1000, 200), 100);
  assert.equal(scrollDepthPercent(400, 1000, 200), 50);
  assert.equal(scrollDepthPercent(0, 200, 200), 100);
});

test("section visibility counts sections scrolled through and ignores a tall block that has only started", () => {
  const sections = [
    { top: 0, bottom: 200 },
    { top: 400, bottom: 600 },
    { top: 900, bottom: 1100 },
    { top: 1400, bottom: 1600 },
  ];
  assert.equal(sectionVisibilityPercent(sections, 0, 800), 50);
  assert.equal(sectionVisibilityPercent(sections, 700, 800), 75);
  assert.equal(sectionVisibilityPercent([{ top: 0, bottom: 2400 }], 0, 800), 0);
  assert.equal(sectionVisibilityPercent([{ top: 0, bottom: 2400 }], 1700, 800), 100);
  assert.equal(sectionVisibilityPercent([], 0, 800), null);
});

test("reading percent keeps the deeper of scroll, sections, and what was already stored", () => {
  assert.equal(combineReadPercent(10, 40, 25), 40);
  assert.equal(combineReadPercent(80, 40, 25), 80);
  assert.equal(combineReadPercent(5, 10, 60), 60);
});

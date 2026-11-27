import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GUEST_HONESTY_COPY,
  GUEST_OPEN_LESSON_ID,
  GUEST_PATH_NODES,
  guestLesson,
} from "./guest-preview.ts";

test("the sample path shows completed, active, and locked steps, plus a practice gap", () => {
  const states = new Set(GUEST_PATH_NODES.map((node) => node.state));
  assert.ok(states.has("mastered"));
  assert.ok(states.has("locked"));
  assert.equal(
    GUEST_PATH_NODES.filter((node) => node.current).map((node) => node.id).join(","),
    GUEST_OPEN_LESSON_ID,
  );
  const current = GUEST_PATH_NODES.find((node) => node.id === GUEST_OPEN_LESSON_ID);
  assert.equal(current?.state, "in-progress");

  const gap = GUEST_PATH_NODES.find((node) => node.kind === "gap");
  assert.ok(gap);
  assert.equal(gap.title, "Practice lesson ready");
  assert.equal(gap.state, "available");
  assert.equal(gap.unmet.length, 0);
  const parentAt = GUEST_PATH_NODES.findIndex((node) => node.id === gap.parentId);
  const gapAt = GUEST_PATH_NODES.findIndex((node) => node.id === gap.id);
  assert.ok(parentAt >= 0 && parentAt < gapAt);

  const ids = GUEST_PATH_NODES.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every open step has an excerpt, both sources, and a spaced-review chip", () => {
  const openable = GUEST_PATH_NODES.filter((node) => node.state !== "locked");
  assert.ok(openable.length >= 4);
  for (const node of openable) {
    const lesson = guestLesson(node.id);
    assert.ok(lesson, node.id);
    assert.equal(lesson.title, node.title);
    assert.ok(lesson.excerpt.every((paragraph) => paragraph.trim().length > 40));
    assert.ok(lesson.citations.some((item) => item.kind === "scripture" && item.reference.startsWith("Ruth ")));
    assert.ok(lesson.citations.some((item) => item.kind === "confession" && item.label.includes("Westminster")));
    assert.match(lesson.review, /^Spaced review/);
    assert.match(lesson.xp, /\d+ XP/);
  }
  for (const node of GUEST_PATH_NODES.filter((item) => item.state === "locked" && item.kind !== "final")) {
    assert.ok(node.unmet.length > 0);
    assert.equal(guestLesson(node.id), null);
  }
});

test("the landing honesty line is the faithfulness copy", () => {
  assert.equal(
    GUEST_HONESTY_COPY,
    "Lessons and quizzes are AI-generated; Scripture and historical sources are retrieved from the library.",
  );
});

test("signed-out landing mounts the preview and leaves the signed-in branch alone", () => {
  const gate = readFileSync(new URL("../../components/AuthGate.tsx", import.meta.url), "utf8");
  const view = readFileSync(new URL("../../components/GuestPreview.tsx", import.meta.url), "utf8");
  assert.match(gate, /if \(session === "in"\) return <>\{children\}<\/>;/);
  assert.match(gate, /if \(!publishableKey\) return <GuestPreview \/>;/);
  assert.match(gate, /fallback=\{<GuestPreview \/>\}/);
  assert.doesNotMatch(gate, /RedirectToSignIn/);
  assert.match(view, /Sign in to build your own path/);
  assert.match(view, /href="\/sign-in"/);
  assert.match(view, /GUEST_HONESTY_COPY/);
  assert.match(view, /LearnPathMap/);
  assert.doesNotMatch(`${gate}\n${view}`, /window\.(alert|confirm|prompt)/);
  assert.doesNotMatch(`${gate}\n${view}`, /<GuestPreview[\s\S]*session === "in"/);
});

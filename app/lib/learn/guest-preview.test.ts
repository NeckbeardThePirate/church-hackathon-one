import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GUEST_HONESTY_COPY,
  GUEST_OPEN_LESSON_ID,
  GUEST_PATH_NODES,
  GUEST_SAMPLE_BASE_XP,
  GUEST_SAMPLE_CHECK_XP,
  GUEST_SAMPLE_GAP_ID,
  GUEST_SAMPLE_GAP_NODE,
  GUEST_SAMPLE_QUESTION,
  guestChoiceVisual,
  guestHighlightId,
  guestLesson,
  guestPathNodes,
  guestSampleFeedback,
  guestSampleHeading,
  guestSamplePhase,
  initialGuestSample,
  pickGuestSample,
  revealGuestMiss,
  resetGuestSample,
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
    assert.ok(lesson.citations.some((item) => item.kind === "scripture" && item.reference.startsWith("John ")));
    assert.ok(lesson.citations.some((item) => item.kind === "scripture" && item.note.includes("Berean Study Bible")));
    assert.ok(lesson.citations.some((item) => item.kind === "library" && item.text.trim().length > 40));
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
    "This lesson is partially AI generated.",
  );
});

test("the sample check starts idle, at the bundled XP, with no extra gap", () => {
  const state = initialGuestSample();
  assert.equal(guestSamplePhase(state), "idle");
  assert.equal(state.pickedId, null);
  assert.equal(state.correct, null);
  assert.equal(state.gapSpawned, false);
  assert.equal(state.xp, GUEST_SAMPLE_BASE_XP);
  assert.equal(state.awardTick, 0);
  assert.equal(guestSampleHeading(state), null);
  assert.equal(guestSampleFeedback(state), null);
  assert.equal(guestHighlightId(state), null);
  assert.equal(GUEST_SAMPLE_QUESTION.lessonId, GUEST_OPEN_LESSON_ID);
  assert.equal(GUEST_SAMPLE_QUESTION.correctId, "christ");

  const path = guestPathNodes(state);
  assert.equal(path.length, GUEST_PATH_NODES.length);
  assert.equal(path.some((node) => node.id === GUEST_SAMPLE_GAP_ID), false);
  assert.equal(GUEST_PATH_NODES.some((node) => node.id === GUEST_SAMPLE_GAP_ID), false);
  for (const choice of GUEST_SAMPLE_QUESTION.choices) {
    assert.equal(guestChoiceVisual(state, choice.id), "idle");
  }
});

test("a right answer credits sample XP and does not spawn a gap", () => {
  const start = initialGuestSample();
  const right = pickGuestSample(start, "christ");
  assert.notEqual(right, start);
  assert.equal(guestSamplePhase(right), "correct");
  assert.equal(right.correct, true);
  assert.equal(right.pickedId, "christ");
  assert.equal(right.gapSpawned, false);
  assert.equal(right.xp, GUEST_SAMPLE_BASE_XP + GUEST_SAMPLE_CHECK_XP);
  assert.equal(GUEST_SAMPLE_CHECK_XP, 5);
  assert.equal(right.awardTick, 1);
  assert.equal(guestSampleHeading(right), "That’s right");
  assert.match(guestSampleFeedback(right) ?? "", /Christ, the Son of God/);
  assert.equal(guestHighlightId(right), null);
  assert.equal(guestPathNodes(right).some((node) => node.id === GUEST_SAMPLE_GAP_ID), false);
  assert.equal(guestChoiceVisual(right, "christ"), "correct");
  assert.equal(guestChoiceVisual(right, "prophet"), "idle");

  const again = pickGuestSample(right, "prophet");
  assert.equal(again, right);
  assert.equal(again.xp, GUEST_SAMPLE_BASE_XP + GUEST_SAMPLE_CHECK_XP);
  assert.equal(again.gapSpawned, false);
});

test("a wrong answer or the miss control spawns one new practice gap under the lesson", () => {
  const bundled = GUEST_PATH_NODES.map((node) => node.id).join(",");
  const wrong = pickGuestSample(initialGuestSample(), "priest");
  assert.equal(guestSamplePhase(wrong), "missed");
  assert.equal(wrong.correct, false);
  assert.equal(wrong.xp, GUEST_SAMPLE_BASE_XP);
  assert.equal(wrong.awardTick, 0);
  assert.equal(wrong.gapSpawned, true);
  assert.equal(guestSampleHeading(wrong), "A practice step opened");
  assert.match(guestSampleFeedback(wrong) ?? "", /practice step is now on the path/);
  assert.equal(guestChoiceVisual(wrong, "christ"), "correct");
  assert.equal(guestChoiceVisual(wrong, "priest"), "wrong");
  assert.equal(guestChoiceVisual(wrong, "prophet"), "idle");

  const path = guestPathNodes(wrong);
  assert.equal(path.filter((node) => node.id === GUEST_SAMPLE_GAP_ID).length, 1);
  const fieldAt = path.findIndex((node) => node.id === GUEST_OPEN_LESSON_ID);
  const gapAt = path.findIndex((node) => node.id === GUEST_SAMPLE_GAP_ID);
  assert.equal(gapAt, fieldAt + 1);
  assert.equal(path[gapAt]?.parentId, GUEST_OPEN_LESSON_ID);
  assert.equal(path[gapAt]?.kind, "gap");
  assert.equal(path[gapAt]?.state, "available");
  assert.equal(path[gapAt]?.title, "Practice: that you may believe");
  assert.equal(path[gapAt]?.unmet.length, 0);
  assert.equal(guestHighlightId(wrong), GUEST_SAMPLE_GAP_ID);
  assert.equal(new Set(path.map((node) => node.id)).size, path.length);
  assert.equal(GUEST_PATH_NODES.map((node) => node.id).join(","), bundled);
  assert.equal(revealGuestMiss(wrong), wrong);

  const opened = revealGuestMiss(initialGuestSample());
  assert.equal(guestSamplePhase(opened), "opened");
  assert.equal(opened.pickedId, null);
  assert.equal(opened.correct, null);
  assert.equal(opened.gapSpawned, true);
  assert.equal(opened.xp, GUEST_SAMPLE_BASE_XP);
  assert.equal(guestSampleHeading(opened), "A practice step opened");
  assert.match(guestSampleFeedback(opened) ?? "", /what a miss does/);
  assert.equal(guestChoiceVisual(opened, "christ"), "idle");
  assert.equal(guestPathNodes(opened).filter((node) => node.id === GUEST_SAMPLE_GAP_ID).length, 1);
  assert.equal(revealGuestMiss(opened), opened);

  const thenRight = pickGuestSample(opened, "christ");
  assert.equal(thenRight.gapSpawned, true);
  assert.equal(thenRight.correct, true);
  assert.equal(thenRight.xp, GUEST_SAMPLE_BASE_XP + GUEST_SAMPLE_CHECK_XP);
  assert.equal(guestSamplePhase(thenRight), "correct");
  assert.equal(guestHighlightId(thenRight), GUEST_SAMPLE_GAP_ID);
});

test("an unknown choice is ignored and reset clears the sample", () => {
  const start = initialGuestSample();
  assert.equal(pickGuestSample(start, "nope"), start);
  assert.equal(pickGuestSample(start, ""), start);

  const missed = pickGuestSample(start, "prophet");
  const cleared = resetGuestSample();
  assert.deepEqual(cleared, initialGuestSample());
  assert.equal(cleared.gapSpawned, false);
  assert.equal(guestPathNodes(cleared).some((node) => node.id === GUEST_SAMPLE_GAP_ID), false);
  assert.equal(missed.gapSpawned, true);

  const credited = pickGuestSample(start, "christ");
  const afterMiss = revealGuestMiss(credited);
  assert.equal(afterMiss.correct, true);
  assert.equal(afterMiss.gapSpawned, true);
  assert.equal(afterMiss.xp, credited.xp);
  assert.equal(afterMiss.pickedId, "christ");
  assert.deepEqual(resetGuestSample(), initialGuestSample());
});

test("the spawned practice lesson retrieves John and Matthew Henry", () => {
  const lesson = guestLesson(GUEST_SAMPLE_GAP_ID);
  assert.ok(lesson);
  assert.equal(lesson.id, GUEST_SAMPLE_GAP_NODE.id);
  assert.equal(lesson.title, GUEST_SAMPLE_GAP_NODE.title);
  assert.equal(lesson.title, "Practice: that you may believe");
  assert.ok(lesson.excerpt.every((paragraph) => paragraph.trim().length > 40));
  const scripture = lesson.citations.find((item) => item.kind === "scripture");
  const henry = lesson.citations.find((item) => item.kind === "library");
  assert.ok(scripture && scripture.kind === "scripture");
  assert.equal(scripture.reference, "John 20:31");
  assert.match(scripture.text, /so that you may believe that Jesus is the Christ, the Son of God/);
  assert.match(scripture.text, /life in His name/);
  assert.match(scripture.note, /Berean Study Bible/);
  assert.ok(henry && henry.kind === "library");
  assert.equal(henry.source, "commentary");
  assert.equal(henry.label, "Matthew Henry");
  assert.equal(henry.detail, "John 20:26–31");
  assert.match(henry.text, /bring men to Christ and heaven, and, in order to this, to persuade men to believe/);
  assert.equal(
    GUEST_HONESTY_COPY,
    "This lesson is partially AI generated.",
  );
});

test("open steps cite the Berean text, a confession, Augustine, and Matthew Henry", () => {
  const openable = GUEST_PATH_NODES.filter((node) => node.state !== "locked");
  const library = openable.flatMap((node) => guestLesson(node.id)?.citations ?? []).filter((item) => item.kind === "library");
  assert.ok(library.some((item) => item.kind === "library" && item.source === "confession" && item.label.includes("Westminster")));
  assert.ok(library.some((item) => item.kind === "library" && item.source === "father" && item.label === "Augustine"));
  assert.ok(library.some((item) => item.kind === "library" && item.source === "commentary" && item.label === "Matthew Henry"));
  const augustine = library.find((item) => item.kind === "library" && item.label === "Augustine");
  const confession = library.find((item) => item.kind === "library" && item.detail === "8.2");
  assert.ok(augustine && augustine.kind === "library");
  assert.match(augustine.text, /became a medicine unto us/);
  assert.ok(confession && confession.kind === "library");
  assert.match(confession.text, /two whole, perfect, and distinct natures, the Godhead and the manhood/);
  const flesh = guestLesson("john-flesh");
  assert.match(flesh?.citations.find((item) => item.kind === "scripture")?.text ?? "", /The Word became flesh and made His dwelling among us/);
});

test("guest preview copy does not name the previous sample book", () => {
  const source = readFileSync(new URL("./guest-preview.ts", import.meta.url), "utf8");
  const view = readFileSync(new URL("../../components/GuestPreview.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("Ruth"), false);
  assert.equal(view.includes("Ruth"), false);
  assert.match(view, /Berean Study Bible · retrieved/);
  assert.match(view, /librarySourceLabel/);
  assert.match(source, /The Gospel of John/);
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
  assert.match(view, /Try a quick check/);
  assert.match(view, /See what happens when you miss/);
  assert.match(view, /Reset sample/);
  assert.match(view, /data-guest-sample-actions/);
  assert.match(view, /border-t border-\[var\(--line\)\]/);
  assert.match(view, /pickGuestSample/);
  assert.match(view, /revealGuestMiss/);
  assert.match(view, /guestPathNodes/);
  assert.match(view, /guest-xp-pop/);
  assert.match(view, /data-guest-xp-chip/);
  assert.match(view, /data-guest-gap/);
  assert.doesNotMatch(view, /fetch\(/);
  assert.doesNotMatch(`${gate}\n${view}`, /window\.(alert|confirm|prompt)/);
  assert.doesNotMatch(`${gate}\n${view}`, /<GuestPreview[\s\S]*session === "in"/);

  const map = readFileSync(new URL("../../components/LearnPathMap.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
  assert.match(map, /highlightId/);
  assert.match(map, /path-node-enter/);
  assert.match(map, /data-path-highlight/);
  assert.match(css, /\.path-node-enter/);
  assert.match(css, /\.guest-xp-pop/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

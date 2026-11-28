import assert from "node:assert/strict";
import test from "node:test";
import { visibleLibraryCards } from "./library-cards.ts";
import type { LearnLesson, LibraryCitation } from "./types.ts";

function card(over: Pick<LibraryCitation, "id" | "source" | "label" | "text"> & Partial<LibraryCitation>): LibraryCitation {
  return { note: "", ...over };
}

function bornAgain(library: LibraryCitation[]): Pick<LearnLesson, "title" | "objectives" | "scripture" | "searchHints" | "teaching" | "library"> {
  return {
    title: "Born Again",
    objectives: ["Explain what born of water and the Spirit means in John 3"],
    searchHints: ["Nicodemus"],
    scripture: [{ reference: "John 3:1-15", text: "A ruler came by night.", note: "" }],
    teaching: [{ type: "paragraph", text: "Nicodemus asks how someone can be born again." }],
    library,
  };
}

test("a stored John 3 lesson drops the fall and the mediator cards and keeps two confessions", () => {
  const visible = visibleLibraryCards(
    bornAgain([
      card({
        id: "basel-2",
        source: "confession",
        label: "First Confession of Basel Art. II",
        text: "Of the fall of man. Man was created upright. By the fall he brought death and corruption on his descendants.",
      }),
      card({
        id: "hc-17",
        source: "confession",
        label: "Heidelberg Catechism Q17",
        text: "Why must the mediator also be true God? That by the power of his divinity he might bear God's anger in his humanity and restore righteousness and life.",
      }),
      card({
        id: "hc-33",
        source: "confession",
        label: "Heidelberg Catechism Q33",
        text: "Why is he called God's only begotten Son? Because Christ alone is the eternal natural Son. We are adopted children by grace.",
      }),
      card({
        id: "birth",
        source: "confession",
        label: "Westminster Confession of Faith 10.1",
        text: "The new birth is regeneration, which the Holy Spirit works.",
      }),
      card({
        id: "baptism",
        source: "confession",
        label: "Belgic Confession Art. 34",
        text: "Baptism signifies regeneration and the washing of the new birth.",
      }),
      card({
        id: "extra",
        source: "confession",
        label: "Canons of Dort III/IV.12",
        text: "Regeneration is the new birth wrought by the Holy Spirit.",
      }),
    ]),
    "Reformed",
  );
  const confessions = visible.filter((item) => item.source === "confession");
  assert.deepEqual(
    confessions.map((item) => item.id),
    ["birth", "baptism"],
  );
  assert.equal(confessions.some((item) => /basel|Q17|Q33/i.test(item.label)), false);
});

test("commentaries on the lesson passage stay, and each kind stops at two", () => {
  const visible = visibleLibraryCards(
    bornAgain([
      card({
        id: "henry",
        source: "commentary",
        label: "Matthew Henry",
        detail: "John 3:5",
        text: "A note on the conversation with Nicodemus.",
      }),
      card({
        id: "off",
        source: "commentary",
        label: "Matthew Henry",
        detail: "Genesis 3",
        text: "A note on the fall of man and the first disobedience.",
      }),
      card({
        id: "father-1",
        source: "father",
        label: "Augustine",
        detail: "John 3",
        text: "A homily on this chapter.",
      }),
      card({
        id: "father-2",
        source: "father",
        label: "Chrysostom",
        detail: "John 3:8",
        text: "The wind and the Spirit.",
      }),
      card({
        id: "father-3",
        source: "father",
        label: "Origen",
        detail: "John 3:5",
        text: "Another homily on the same chapter.",
      }),
    ]),
  );
  assert.deepEqual(
    visible.map((item) => item.id),
    ["henry", "father-1", "father-2"],
  );
});

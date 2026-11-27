import assert from "node:assert/strict";
import test from "node:test";
import { visibleCitationNote } from "./citation-note.ts";

test("stock retrieval captions are not shown under a citation", () => {
  assert.equal(visibleCitationNote("Quoted from the confession text stored for this section."), "");
  assert.equal(visibleCitationNote("  Quoted from the father text stored for this passage.  "), "");
  assert.equal(visibleCitationNote("From the retrieved commentary text."), "");
  assert.equal(visibleCitationNote("Comment on Romans 8:1."), "");
  assert.equal(visibleCitationNote("Comment on Romans 8:1–4."), "");
  assert.equal(visibleCitationNote("Comment on 1 Corinthians 13:4-7."), "");
  assert.equal(visibleCitationNote("A passage you chose."), "");
});

test("a connection note stays on the card", () => {
  const note = "The confession’s chapter on providence. It is not a commentary on Ruth.";
  assert.equal(visibleCitationNote(note), note);
  assert.equal(visibleCitationNote("  Why it connects.  "), "Why it connects.");
  assert.equal(visibleCitationNote(""), "");
});

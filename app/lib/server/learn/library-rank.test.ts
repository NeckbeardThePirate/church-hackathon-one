import assert from "node:assert/strict";
import test from "node:test";
import { citationRelevant, retrievalFocus, selectRelevant } from "./library-rank.ts";

const JOHN3 = "What does born of water and the Spirit mean in John 3:5? Nicodemus and the new birth.";

test("John 3 retrieval adds regeneration terms and the companion passages", () => {
  const focus = retrievalFocus(JOHN3);
  for (const term of ["regeneration", "new birth", "holy spirit", "baptism"]) {
    assert.ok(focus.strong.includes(term), term);
  }
  assert.ok(focus.refs.includes("Ezekiel 36:25-27"));
  assert.ok(focus.refs.includes("John 3:5"));
  assert.ok(focus.refs.includes("John 3:8"));
});

test("off-topic confession cards drop and a regeneration card stays", () => {
  const focus = retrievalFocus(JOHN3);
  const fall = "First Basel Confession Article II. God created man upright. By the fall he became subject to sin and death.";
  const heidelberg17 = "Heidelberg Catechism Question 17. Why must the mediator be true God, that he might bear the wrath of God against sin?";
  const heidelberg33 = "Heidelberg Catechism Question 33. Why is he called Christ, that is, anointed? Because he is ordained of God the Father.";
  const kept = "Baptism signifies regeneration and the new birth by the Holy Spirit.";
  assert.equal(citationRelevant(fall, focus), false);
  assert.equal(citationRelevant(heidelberg17, focus), false);
  assert.equal(citationRelevant(heidelberg33, focus), false);
  assert.equal(citationRelevant(kept, focus), true);

  const hits = [
    { id: "basel", text: fall },
    { id: "q17", text: heidelberg17 },
    { id: "q33", text: heidelberg33 },
    { id: "birth", text: kept },
  ];
  const selected = selectRelevant(hits, (hit) => hit.text, focus, { limit: 2 });
  assert.deepEqual(selected.map((hit) => hit.id), ["birth"]);
});

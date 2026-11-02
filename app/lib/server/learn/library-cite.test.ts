import assert from "node:assert/strict";
import test from "node:test";
import { rankForPerspective } from "./library-rank.ts";

test("Reformed plans sort Westminster and the Three Forms ahead of other standards", () => {
  const hits = [
    { document: "Catechism of the Catholic Church", label: "1987" },
    { document: "Westminster Confession of Faith", label: "11.1" },
    { document: "Heidelberg Catechism", label: "Q. 60" },
  ];
  const ranked = rankForPerspective(hits, "Reformed").map((hit) => hit.document);
  assert.equal(ranked[2], "Catechism of the Catholic Church");
  assert.ok(ranked.indexOf("Westminster Confession of Faith") < ranked.indexOf("Catechism of the Catholic Church"));
});

test("other perspectives keep retrieval order", () => {
  const hits = [{ document: "A" }, { document: "Westminster Confession of Faith" }];
  assert.deepEqual(
    rankForPerspective(hits, "neutral").map((hit) => hit.document),
    ["A", "Westminster Confession of Faith"],
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const note = readFileSync(new URL("./SourceNote.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./LearnAgentFloat.tsx", import.meta.url), "utf8");

test("the course tutor uses the shared honesty note", () => {
  const tutor = /tutor:\s*\n\s*"([^"]+)"/.exec(note);
  assert.ok(tutor?.[1], "tutor copy is missing");
  assert.match(tutor[1], /AI-generated/);
  assert.match(tutor[1], /retrieved from the library/);
  assert.match(tutor[1], /not written by the model/);
  assert.match(panel, /<SourceNote place="tutor" compact \/>/);
  assert.match(panel, /Uses this lesson/);
  assert.doesNotMatch(panel, /window\.(alert|confirm|prompt)/);
});

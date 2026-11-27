import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isQuietWorkspace,
  parseWelcomeStatus,
  reconcileWelcomeStatus,
  shouldShowWelcomeIntro,
} from "./welcome.ts";

test("welcome status only accepts a stored decision", () => {
  assert.equal(parseWelcomeStatus(null), "unseen");
  assert.equal(parseWelcomeStatus(""), "unseen");
  assert.equal(parseWelcomeStatus("later"), "unseen");
  assert.equal(parseWelcomeStatus("dismissed"), "dismissed");
  assert.equal(parseWelcomeStatus("completed"), "completed");
});

test("an empty unseen desk shows the intro, and a decision or a path keeps it closed", () => {
  assert.equal(shouldShowWelcomeIntro("unseen", false, false), true);
  assert.equal(shouldShowWelcomeIntro("dismissed", false, false), false);
  assert.equal(shouldShowWelcomeIntro("completed", false, false), false);
  assert.equal(shouldShowWelcomeIntro("unseen", true, false), false);
  assert.equal(shouldShowWelcomeIntro("dismissed", false, true), true);
  assert.equal(shouldShowWelcomeIntro("completed", true, true), false);
});

test("the server decision wins, and a local decision fills an empty server", () => {
  assert.deepEqual(reconcileWelcomeStatus("unseen", "dismissed"), { status: "dismissed", push: null });
  assert.deepEqual(reconcileWelcomeStatus("completed", "dismissed"), { status: "dismissed", push: null });
  assert.deepEqual(reconcileWelcomeStatus("dismissed", "unseen"), { status: "dismissed", push: "dismissed" });
  assert.deepEqual(reconcileWelcomeStatus("unseen", "unseen"), { status: "unseen", push: null });
});

test("a desk with no path stays quiet, and any path brings the rest of the app back", () => {
  assert.equal(isQuietWorkspace(false, true), true);
  assert.equal(isQuietWorkspace(false, false), false);
  assert.equal(isQuietWorkspace(true, true), false);
});

test("the empty desk is one welcome entry, not the progress dashboard", () => {
  const app = readFileSync(new URL("../../components/WorkspaceApp.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../../components/WelcomeWalkthrough.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../../components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(app, /shouldOfferStarterPath\(projects\)/);
  assert.match(app, /focusMode=\{quietHome\}/);
  assert.match(app, /quietHome \?/);
  assert.match(home, /Skip/);
  assert.match(home, /Use my own passage, notes, or photo/);
  assert.match(home, /Daily goal/);
  assert.match(shell, /focusMode/);
  assert.doesNotMatch(home, /\b(alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(app, /\b(alert|confirm|prompt)\s*\(/);
});

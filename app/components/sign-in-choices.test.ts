import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readAuthProviders, signInChoiceVisibility } from "./sign-in-choices.ts";

test("ChatGPT stays hidden until providers say it is configured", () => {
  assert.deepEqual(signInChoiceVisibility(null, false), {
    pending: true,
    hidden: true,
    chatgpt: false,
    dev: false,
  });

  const unconfigured = signInChoiceVisibility({ clerk: true, chatgpt: false, dev: false }, false);
  assert.equal(unconfigured.chatgpt, false);
  assert.equal(unconfigured.dev, false);
  assert.equal(unconfigured.hidden, true);

  const configured = signInChoiceVisibility({ clerk: true, chatgpt: true, dev: false }, false);
  assert.equal(configured.chatgpt, true);
  assert.equal(configured.hidden, false);

  const loopbackOnly = signInChoiceVisibility({ clerk: false, chatgpt: false, dev: true }, false);
  assert.equal(loopbackOnly.chatgpt, false);
  assert.equal(loopbackOnly.dev, true);
  assert.equal(loopbackOnly.hidden, false);

  const neither = signInChoiceVisibility({ clerk: false, chatgpt: false, dev: false }, false);
  assert.equal(neither.chatgpt, false);
  assert.equal(neither.hidden, false);
});

test("a sign-in error still renders when ChatGPT is not configured", () => {
  const visibility = signInChoiceVisibility({ clerk: true, chatgpt: false, dev: false }, true);
  assert.equal(visibility.chatgpt, false);
  assert.equal(visibility.hidden, false);
  assert.equal(visibility.pending, false);
});

test("a providers payload only enables ChatGPT when the flag is true", () => {
  assert.equal(readAuthProviders(null).chatgpt, false);
  assert.equal(readAuthProviders({ clerk: true }).chatgpt, false);
  assert.equal(readAuthProviders({ chatgpt: true, clerk: false, dev: false }).chatgpt, true);
  assert.equal(readAuthProviders({ chatgpt: "yes" }).chatgpt, false);
});

test("the ChatGPT button and its plan copy follow providers.chatgpt", () => {
  const source = readFileSync(new URL("./SignInChoices.tsx", import.meta.url), "utf8");
  const button = source.slice(source.indexOf("visibility.chatgpt ? ("), source.indexOf("visibility.dev ? ("));
  assert.match(button, /href="\/api\/auth\/chatgpt\/start"/);
  assert.match(button, /Continue with ChatGPT/);
  assert.match(source, /visibility\.chatgpt\s*\?\s*" If you grant ChatGPT plan usage/);
  assert.equal(source.split('href="/api/auth/chatgpt/start"').length, 2);
  assert.match(source, /signInChoiceVisibility\(providers, Boolean\(error\)\)/);
  assert.match(source, /if \(visibility\.pending \|\| visibility\.hidden\) return null/);
  assert.doesNotMatch(source, /chatgpt:\s*true/);
});

test("guest preview, the header, and dialogs do not render a ChatGPT sign-in button", () => {
  const files = ["GuestPreview.tsx", "AppShell.tsx", "AuthChrome.tsx", "AuthGate.tsx", "ConfirmDialog.tsx"];
  for (const file of files) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\/api\/auth\/chatgpt\/start/, file);
    assert.doesNotMatch(source, /Continue with ChatGPT/, file);
  }
});

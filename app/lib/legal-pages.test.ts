import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

test("privacy and terms are public documents with a way home", () => {
  const privacy = read("app/privacy/page.tsx");
  const terms = read("app/terms/page.tsx");
  const chrome = read("app/components/LegalPage.tsx");
  assert.match(chrome, /href="\/"/);
  assert.match(chrome, /judah@hellands\.com/);
  assert.doesNotMatch(chrome, /AuthGate|RedirectToSignIn|clerkMiddleware/);
  for (const page of [privacy, terms]) {
    assert.doesNotMatch(page, /use client/);
    assert.doesNotMatch(page, /AuthGate|RedirectToSignIn|clerkMiddleware/);
    assert.match(page, /LegalPage/);
    assert.match(page, /MailLink/);
    assert.match(page, /thelightlabs\.dev/);
    assert.match(page, /Light Labs/);
    assert.match(page, /Judah Helland/);
  }
  assert.match(privacy, /Clerk/);
  assert.match(privacy, /Google/);
  assert.match(privacy, /Durable Object/);
  assert.match(privacy, /Cloudflare D1/);
  assert.match(privacy, /does not sell personal data/);
  assert.match(privacy, /AI models/);
  assert.match(privacy, /delete your account/);
  assert.match(terms, /Scripture/);
  assert.match(terms, /as is/);
  assert.match(terms, /personal study/);
  assert.match(read("app/page.tsx"), /AuthGate/);
});

test("signed-out landing and sign-in link to privacy and terms", () => {
  const links = read("app/components/LegalLinks.tsx");
  assert.match(links, /href="\/privacy"/);
  assert.match(links, /href="\/terms"/);
  assert.match(read("app/components/GuestPreview.tsx"), /LegalLinks/);
  assert.match(read("app/components/AuthChrome.tsx"), /LegalLinks/);
  assert.match(read("app/sign-in/[[...sign-in]]/page.tsx"), /AuthChrome/);
});

test("auth middleware, if present, leaves privacy and terms public", () => {
  for (const name of ["middleware.ts", "middleware.js", "src/middleware.ts", "proxy.ts", "src/proxy.ts"]) {
    const file = new URL(name, root);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    assert.match(text, /\/privacy/);
    assert.match(text, /\/terms/);
  }
});

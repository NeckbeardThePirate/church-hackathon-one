import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackHost, signSession, verifySession } from "./session.ts";

test("session cookie round-trips and rejects tampering", async () => {
  const secret = "test-secret";
  const token = await signSession(
    { userId: "oai_abc", provider: "chatgpt", compute: true, exp: Math.floor(Date.now() / 1000) + 60 },
    secret,
  );
  const claims = await verifySession(token, secret);
  assert.equal(claims?.userId, "oai_abc");
  assert.equal(claims?.compute, true);

  const flipped = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(await verifySession(flipped, secret), null);
  assert.equal(await verifySession(token, "other-secret"), null);
});

test("expired sessions are rejected", async () => {
  const token = await signSession(
    { userId: "dev_local", provider: "dev", compute: false, exp: Math.floor(Date.now() / 1000) - 10 },
    "test-secret",
  );
  assert.equal(await verifySession(token, "test-secret"), null);
});

test("loopback hosts are recognized", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("church-hackathon.lightlabs.workers.dev"), false);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  authGateView,
  bindAuthSessionRequest,
  createAuthSessionLoader,
  isClerkClientSettled,
  requestAuthSession,
  shouldRequestAuthSession,
  type AuthSessionGateInput,
  type AuthSessionStatus,
} from "./auth-session-gate.ts";

test("Clerk is settled only after the initial client load", () => {
  assert.equal(isClerkClientSettled("loading"), false);
  assert.equal(isClerkClientSettled(undefined), false);
  assert.equal(isClerkClientSettled(null), false);
  assert.equal(isClerkClientSettled("ready"), true);
  assert.equal(isClerkClientSettled("degraded"), true);
  assert.equal(isClerkClientSettled("error"), true);
});

test("the session endpoint waits for Clerk and still runs for cookie sign-in", () => {
  const waiting: AuthSessionGateInput = {
    configReady: false,
    hasClerk: false,
    clerkClientReady: false,
    session: "loading",
  };
  assert.equal(shouldRequestAuthSession(waiting), false);

  const keyKnownClerkLoading: AuthSessionGateInput = {
    configReady: true,
    hasClerk: true,
    clerkClientReady: false,
    session: "loading",
  };
  assert.equal(shouldRequestAuthSession(keyKnownClerkLoading), false);

  const clerkReady: AuthSessionGateInput = { ...keyKnownClerkLoading, clerkClientReady: true };
  assert.equal(shouldRequestAuthSession(clerkReady), true);

  const clerkFailed: AuthSessionGateInput = { ...keyKnownClerkLoading, clerkClientReady: isClerkClientSettled("error") };
  assert.equal(shouldRequestAuthSession(clerkFailed), true);

  const cookieOnly: AuthSessionGateInput = {
    configReady: true,
    hasClerk: false,
    clerkClientReady: false,
    session: "loading",
  };
  assert.equal(shouldRequestAuthSession(cookieOnly), true);

  assert.equal(shouldRequestAuthSession({ ...clerkReady, session: "in" }), false);
  assert.equal(shouldRequestAuthSession({ ...clerkReady, session: "out" }), false);
});

test("a signed-in session stays on the app while Clerk status changes", () => {
  assert.equal(authGateView({ session: "loading", hasClerk: true }), "loading");
  assert.equal(authGateView({ session: "loading", hasClerk: false }), "loading");
  assert.equal(authGateView({ session: "in", hasClerk: true }), "app");
  assert.equal(authGateView({ session: "in", hasClerk: false }), "app");
  assert.equal(authGateView({ session: "out", hasClerk: true }), "clerk");
  assert.equal(authGateView({ session: "out", hasClerk: false }), "choices");
});

test("a cold load does not call /api/auth/session until Clerk is ready, and only once", async () => {
  let calls = 0;
  let resolveRequest: (status: AuthSessionStatus) => void = () => {};
  const load = createAuthSessionLoader(
    () =>
      new Promise((resolve) => {
        calls += 1;
        resolveRequest = resolve;
      }),
  );
  let session: AuthSessionStatus | "loading" = "loading";

  const run = (input: Omit<AuthSessionGateInput, "session">) =>
    bindAuthSessionRequest(shouldRequestAuthSession({ ...input, session }), load, (status) => {
      session = status;
    });

  // First mount, before the publishable key is known.
  run({ configReady: false, hasClerk: false, clerkClientReady: false })();
  // ClerkProvider remounts the gate while the client is still loading. StrictMode replays the effect.
  const early = run({ configReady: true, hasClerk: true, clerkClientReady: false });
  early();
  run({ configReady: true, hasClerk: true, clerkClientReady: false })();
  assert.equal(calls, 0);
  assert.equal(authGateView({ session, hasClerk: true }), "loading");

  // Clerk leaves "loading". StrictMode runs the effect, cleans it up, and runs it again.
  const firstReady = run({ configReady: true, hasClerk: true, clerkClientReady: true });
  firstReady();
  const secondReady = run({ configReady: true, hasClerk: true, clerkClientReady: true });
  await Promise.resolve();
  assert.equal(calls, 1);

  resolveRequest("in");
  await load();
  await Promise.resolve();
  assert.equal(session, "in");
  assert.equal(authGateView({ session, hasClerk: true }), "app");
  secondReady();

  // The signed-in view does not ask again, so the workspace tree is not fetched twice.
  run({ configReady: true, hasClerk: true, clerkClientReady: false })();
  run({ configReady: true, hasClerk: true, clerkClientReady: true })();
  assert.equal(calls, 1);
  assert.equal(session, "in");
  assert.equal(authGateView({ session, hasClerk: true }), "app");
});

test("cookie sign-in fetches once when Clerk is not configured", async () => {
  let calls = 0;
  const load = createAuthSessionLoader(async () => {
    calls += 1;
    return "in";
  });
  let session: AuthSessionStatus | "loading" = "loading";
  const run = (configReady: boolean) =>
    bindAuthSessionRequest(
      shouldRequestAuthSession({ configReady, hasClerk: false, clerkClientReady: false, session }),
      load,
      (status) => {
        session = status;
      },
    );

  run(false)();
  const first = run(true);
  first();
  const second = run(true);
  await Promise.resolve();
  assert.equal(calls, 1);
  await load();
  await Promise.resolve();
  assert.equal(session, "in");
  assert.equal(authGateView({ session, hasClerk: false }), "app");
  second();
});

test("a strict-mode replay shares one in-flight session request", async () => {
  let calls = 0;
  let resolveRequest: (status: AuthSessionStatus) => void = () => {};
  const load = createAuthSessionLoader(
    () =>
      new Promise((resolve) => {
        calls += 1;
        resolveRequest = resolve;
      }),
  );
  let applied = 0;
  const start = () =>
    bindAuthSessionRequest(true, load, () => {
      applied += 1;
    });

  const first = start();
  first();
  const second = start();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveRequest("out");
  await load();
  await Promise.resolve();
  assert.equal(applied, 1);
  second();
});

test("a settled session check can run again on a later mount", async () => {
  let calls = 0;
  const load = createAuthSessionLoader(async () => {
    calls += 1;
    return calls === 1 ? "out" : "in";
  });
  assert.equal(await load(), "out");
  assert.equal(await load(), "in");
  assert.equal(calls, 2);
});

test("the session request treats non-OK and network errors as signed out", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ error: "Sign in required." }), { status: 401 });
  };
  assert.equal(await requestAuthSession(fetchImpl), "out");
  assert.equal(calls[0]?.url, "/api/auth/session");
  assert.equal(calls[0]?.init?.credentials, "same-origin");
  assert.equal(calls[0]?.init?.cache, "no-store");

  const okFetch: typeof fetch = async () => new Response(JSON.stringify({ userId: "user_1" }), { status: 200 });
  assert.equal(await requestAuthSession(okFetch), "in");

  const failing: typeof fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await requestAuthSession(failing), "out");
});

test("the session route stays private and uncacheable", () => {
  const source = readFileSync(new URL("../api/auth/session/route.ts", import.meta.url), "utf8");
  assert.match(source, /["']cache-control["']:\s*["']private, no-store["']/);
});

test("AuthGate loads the session through the gate", () => {
  const source = readFileSync(new URL("./AuthGate.tsx", import.meta.url), "utf8");
  assert.match(source, /shouldRequestAuthSession/);
  assert.match(source, /bindAuthSessionRequest/);
  assert.match(source, /isClerkClientSettled\(clerk\.status\)/);
  assert.match(source, /if \(session === "in"\) return <>\{children\}<\/>;/);
  assert.match(source, /if \(!publishableKey\) return <GuestPreview \/>;/);
  assert.match(source, /fallback=\{<GuestPreview \/>\}/);
  assert.doesNotMatch(source, /RedirectToSignIn/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{[^}]*\/api\/auth\/session/);
});

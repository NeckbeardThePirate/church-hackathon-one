import assert from "node:assert/strict";
import test from "node:test";
import { CHATGPT_CLIENT_COOKIE } from "../../../lib/server/chatgpt-auth.ts";
import { env as workersEnv } from "../../../lib/server/learn/cloudflare-workers-stub.ts";
import { signBlob } from "../../../lib/server/session.ts";
import { GET as startGet } from "../chatgpt/start/route.ts";
import { GET as providersGet } from "./route.ts";

/**
 * Route modules import cloudflare:workers. The test runner loads register-workers-stub.mjs,
 * which resolves that specifier to cloudflare-workers-stub.ts. Mutate `workersEnv` in place.
 */
const SECRET = "providers-test-secret";

type ProviderBody = { clerk: boolean; chatgpt: boolean; dev: boolean; clerkPublishableKey: string | null };

function installEnv(values: Record<string, unknown> = {}): void {
  for (const key of Object.keys(workersEnv)) delete workersEnv[key];
  Object.assign(workersEnv, values);
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

async function providers(url: string, cookie?: string): Promise<ProviderBody> {
  const response = await providersGet(
    new Request(url, cookie ? { headers: { cookie } } : undefined),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, max-age=300");
  return (await response.json()) as ProviderBody;
}

test("a public host without OPENAI_CLIENT_ID does not offer ChatGPT sign-in", async () => {
  installEnv({ SESSION_SECRET: SECRET });
  const body = await providers("https://thelightlabs.dev/api/auth/providers");
  assert.equal(body.chatgpt, false);
  assert.equal(body.clerk, false);
  assert.equal(body.dev, false);

  const start = await startGet(new Request("https://thelightlabs.dev/api/auth/chatgpt/start"));
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location") ?? "");
  assert.equal(location.searchParams.get("auth_error"), "chatgpt_unconfigured");
});

test("a public host with OPENAI_CLIENT_ID offers ChatGPT sign-in", async () => {
  installEnv({ SESSION_SECRET: SECRET, OPENAI_CLIENT_ID: "client_abc" });
  const body = await providers("https://thelightlabs.dev/api/auth/providers");
  assert.equal(body.chatgpt, true);

  const start = await startGet(new Request("https://thelightlabs.dev/api/auth/chatgpt/start"));
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location") ?? "");
  assert.equal(location.origin, "https://auth.openai.com");
  assert.equal(location.searchParams.get("client_id"), "client_abc");
});

test("a blank or placeholder OPENAI_CLIENT_ID is treated as unset on a public host", async () => {
  installEnv({ SESSION_SECRET: SECRET, OPENAI_CLIENT_ID: "   " });
  assert.equal((await providers("https://thelightlabs.dev/api/auth/providers")).chatgpt, false);

  installEnv({ SESSION_SECRET: SECRET, OPENAI_CLIENT_ID: "OPENAI_CLIENT_ID" });
  assert.equal((await providers("https://thelightlabs.dev/api/auth/providers")).chatgpt, false);

  installEnv({ SESSION_SECRET: SECRET, OPENAI_CLIENT_ID: "  client_abc  " });
  assert.equal((await providers("https://thelightlabs.dev/api/auth/providers")).chatgpt, true);
});

test("127.0.0.1 can register a dynamic client without OPENAI_CLIENT_ID", async () => {
  installEnv({});
  const body = await providers("http://127.0.0.1:3000/api/auth/providers");
  assert.equal(body.chatgpt, true);

  const start = await startGet(new Request("http://127.0.0.1:3000/api/auth/chatgpt/start"));
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location") ?? "");
  assert.equal(location.searchParams.get("client_id"), "dynamic_agent_client");
});

test("other loopback hosts stay unconfigured until a client id is set", async () => {
  installEnv({ SESSION_SECRET: SECRET });
  assert.equal((await providers("http://localhost:3000/api/auth/providers")).chatgpt, false);
  assert.equal((await providers("http://[::1]/api/auth/providers")).chatgpt, false);

  installEnv({ SESSION_SECRET: SECRET, OPENAI_CLIENT_ID: "client_abc" });
  assert.equal((await providers("http://localhost:3000/api/auth/providers")).chatgpt, true);
});

test("a saved client cookie configures ChatGPT on a public host that has no OPENAI_CLIENT_ID", async () => {
  installEnv({ SESSION_SECRET: SECRET });
  const token = await signBlob({ clientId: "issued_client" }, SECRET);
  const cookie = `${CHATGPT_CLIENT_COOKIE}=${encodeURIComponent(token)}`;
  assert.equal((await providers("https://thelightlabs.dev/api/auth/providers", cookie)).chatgpt, true);

  const tampered = await signBlob({ clientId: "issued_client" }, "other-secret");
  const badCookie = `${CHATGPT_CLIENT_COOKIE}=${encodeURIComponent(tampered)}`;
  assert.equal((await providers("https://thelightlabs.dev/api/auth/providers", badCookie)).chatgpt, false);

  installEnv({});
  assert.equal((await providers("https://thelightlabs.dev/api/auth/providers", cookie)).chatgpt, false);
});

test("DEV_AUTH does not turn ChatGPT on, and stays loopback-only", async () => {
  installEnv({ DEV_AUTH: "1" });
  const publicHost = await providers("https://thelightlabs.dev/api/auth/providers");
  assert.equal(publicHost.chatgpt, false);
  assert.equal(publicHost.dev, false);

  const loopback = await providers("http://127.0.0.1:3000/api/auth/providers");
  assert.equal(loopback.chatgpt, true);
  assert.equal(loopback.dev, true);
});

/**
 * Optional fallback: a user's ChatGPT plan, only after Workers AI fails
 * and LEARN_CHATGPT_MODEL is set. Tokens stay in the user's Durable Object.
 */
import type { UserWorkspaceDO } from "./user-workspace-do";
import { OPENAI_RESOURCE, OPENAI_TOKEN, type ChatGptIdentity } from "./chatgpt-auth";

type ComputeEnv = {
  LEARN_CHATGPT_MODEL?: string;
  OPENAI_CLIENT_SECRET?: string;
  USER_WORKSPACE?: DurableObjectNamespace;
};

type Stored = ChatGptIdentity;

function textFromResponse(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text.trim();
  const output = record.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
        parts.push((part as Record<string, unknown>).text as string);
      }
    }
  }
  return parts.join("").trim();
}

async function refresh(stored: Stored, clientSecret?: string): Promise<Stored> {
  if (!stored.refreshToken) throw new Error("ChatGPT session cannot be refreshed.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: stored.clientId,
    refresh_token: stored.refreshToken,
    resource: OPENAI_RESOURCE,
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  const response = await fetch(OPENAI_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`ChatGPT refresh failed (${response.status}).`);
  const token = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!token.access_token) throw new Error("ChatGPT refresh returned no access token.");
  const scopes = (token.scope ?? stored.scopes.join(" ")).split(/\s+/).filter(Boolean);
  return {
    ...stored,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? stored.refreshToken,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    scopes,
    compute: scopes.includes("chatgpt.tokens.use.direct"),
  };
}

/** Returns model text, or null when this user has not authorized ChatGPT compute. */
export async function chatGptText(
  env: ComputeEnv,
  userId: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> {
  const model = env.LEARN_CHATGPT_MODEL?.trim();
  if (!model || !env.USER_WORKSPACE || !userId.startsWith("oai_")) return null;
  const stub = env.USER_WORKSPACE.get(env.USER_WORKSPACE.idFromName(userId)) as DurableObjectStub<UserWorkspaceDO>;
  let stored = (await stub.getOauth()) as ChatGptIdentity | null;
  if (!stored?.compute || !stored.accessToken) return null;
  if (stored.expiresAt < Date.now() + 60_000) {
    const next = await refresh(stored, env.OPENAI_CLIENT_SECRET);
    await stub.setOauth(next);
    stored = next;
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${stored.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: maxTokens,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`ChatGPT plan request failed (${response.status}).`);
  }
  const text = textFromResponse(await response.json());
  if (!text) throw new Error("ChatGPT plan request returned no text.");
  return text;
}

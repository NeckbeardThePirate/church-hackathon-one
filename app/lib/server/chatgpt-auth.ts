/**
 * Sign in with ChatGPT (OpenID Connect + PKCE).
 * Website clients use OPENAI_CLIENT_ID from a human-registered OAuth client.
 * On 127.0.0.1 only, the open-source dynamic client can register without a secret.
 * https://developers.openai.com/siwc/quickstart
 */

export const OPENAI_ISSUER = "https://auth.openai.com";
export const OPENAI_AUTHORIZE = "https://auth.openai.com/api/accounts/authorize";
export const OPENAI_TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
export const OPENAI_RESOURCE = "https://api.openai.com/v1";
export const CHATGPT_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const AGENT_NAME = "StudyBuddy";
/** Stable host id for the open-source dynamic client. One installation of this app. */
export const AGENT_HOST_ID = "urn:uuid:7c2a9e14-4b6d-4f1a-9c3e-8a1b2c3d4e5f";

export type OauthPending = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  exp: number;
};

export type ChatGptIdentity = {
  subject: string;
  email?: string;
  name?: string;
  clientId: string;
  scopes: string[];
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  idToken: string;
  compute: boolean;
};

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return b64url(buffer);
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function callbackUrl(request: Request): string {
  const url = new URL(request.url);
  url.pathname = "/api/auth/chatgpt/callback";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function authorizeUrl(pending: OauthPending, returningClient: boolean): Promise<string> {
  const url = new URL(OPENAI_AUTHORIZE);
  url.searchParams.set("client_id", pending.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", pending.redirectUri);
  url.searchParams.set("scope", CHATGPT_SCOPES);
  url.searchParams.set("resource", OPENAI_RESOURCE);
  url.searchParams.set("state", pending.state);
  url.searchParams.set("nonce", pending.nonce);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", await codeChallenge(pending.verifier));
  if (!returningClient && pending.clientId === "dynamic_agent_client") {
    url.searchParams.set("agent_name_hint", AGENT_NAME);
    url.searchParams.set("ext_agent_host_id", AGENT_HOST_ID);
  }
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
};

export async function exchangeCode(input: {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
  clientSecret?: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
    resource: OPENAI_RESOURCE,
  });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  const response = await fetch(OPENAI_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 180);
    throw new Error(`ChatGPT token exchange failed (${response.status}). ${detail}`);
  }
  return (await response.json()) as TokenResponse;
}

function decodePart(part: string): Record<string, unknown> {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

type JwkWithKid = JsonWebKey & { kid?: string };

let jwksCache: { keys: JwkWithKid[]; exp: number } | null = null;

async function jwks(): Promise<JwkWithKid[]> {
  if (jwksCache && jwksCache.exp > Date.now()) return jwksCache.keys;
  const discovery = (await fetch(`${OPENAI_ISSUER}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10000),
  }).then((response) => {
    if (!response.ok) throw new Error("OpenAI discovery document unavailable.");
    return response.json();
  })) as { jwks_uri?: string };
  if (!discovery.jwks_uri) throw new Error("OpenAI discovery document has no jwks_uri.");
  const keys = (await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(10000) }).then((response) => {
    if (!response.ok) throw new Error("OpenAI JWKS unavailable.");
    return response.json();
  })) as { keys?: JwkWithKid[] };
  jwksCache = { keys: keys.keys ?? [], exp: Date.now() + 60 * 60 * 1000 };
  return jwksCache.keys;
}

/** Verify the OpenAI ID token. Audience must be the issued client id. */
export async function verifyIdToken(
  idToken: string,
  expected: { nonce: string; clientId: string },
): Promise<{ subject: string; email?: string; name?: string }> {
  const [headerPart, payloadPart, sigPart] = idToken.split(".");
  if (!headerPart || !payloadPart || !sigPart) throw new Error("Malformed ID token.");
  const header = decodePart(headerPart);
  const payload = decodePart(payloadPart);
  if (header.alg !== "RS256") throw new Error("Unexpected ID token algorithm.");
  const keys = await jwks();
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new Error("ID token signing key was not found.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const sig = Uint8Array.from(atob(sigPart.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, new TextEncoder().encode(`${headerPart}.${payloadPart}`));
  if (!valid) throw new Error("ID token signature is invalid.");
  if (payload.iss !== OPENAI_ISSUER) throw new Error("ID token issuer is invalid.");
  const audience = payload.aud;
  const audiences = Array.isArray(audience) ? audience : [audience];
  if (!audiences.includes(expected.clientId)) throw new Error("ID token audience does not match this client.");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) throw new Error("ID token is expired.");
  if (payload.nonce !== expected.nonce) throw new Error("ID token nonce does not match this sign-in.");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("ID token has no subject.");
  return {
    subject: payload.sub,
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
  };
}

export function identityFromTokenResponse(
  token: TokenResponse,
  identity: { subject: string; email?: string; name?: string },
  clientId: string,
): ChatGptIdentity {
  if (!token.access_token || !token.id_token) throw new Error("ChatGPT token response was incomplete.");
  const scopes = (token.scope ?? "").split(/\s+/).filter(Boolean);
  return {
    subject: identity.subject,
    email: identity.email,
    name: identity.name,
    clientId,
    scopes,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    idToken: token.id_token,
    compute: scopes.includes("chatgpt.tokens.use.direct"),
  };
}

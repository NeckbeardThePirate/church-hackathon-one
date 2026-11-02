/**
 * HMAC session cookie shared by the loopback dev sign-in and Sign in with ChatGPT.
 * Clerk sessions stay on Clerk's own cookie and are checked separately.
 */

export type SessionProvider = "dev" | "chatgpt";

export type SessionClaims = {
  userId: string;
  provider: SessionProvider;
  /** User granted chatgpt.tokens.use.direct. Inference still prefers Workers AI. */
  compute: boolean;
  exp: number;
};

export const SESSION_COOKIE = "sb_session";
export const OAUTH_COOKIE = "sb_oauth";
const MAX_AGE_SEC = 60 * 60 * 24 * 14;

/** Used only for loopback requests when SESSION_SECRET is unset. Never accept it on a public host. */
const LOOPBACK_DEV_SECRET = "studybuddy-dev-session-v1";

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function isLoopbackRequest(request: Request): boolean {
  return isLoopbackHost(new URL(request.url).hostname);
}

export function resolveSessionSecret(request: Request, configured: string | undefined): string | null {
  const trimmed = configured?.trim();
  if (trimmed && trimmed !== "SESSION_SECRET") return trimmed;
  if (isLoopbackRequest(request)) return LOOPBACK_DEV_SECRET;
  return null;
}

export function devAuthAllowed(request: Request, devFlag: string | undefined): boolean {
  return devFlag === "1" && isLoopbackRequest(request);
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToB64url(new Uint8Array(sig));
}

function signaturesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signBlob(value: unknown, secret: string): Promise<string> {
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify(value)));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyBlob<T>(token: string, secret: string): Promise<T | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(secret, payload);
  if (!signaturesMatch(sig, expected)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as T;
  } catch {
    return null;
  }
}

export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  return signBlob(claims, secret);
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  const parsed = await verifyBlob<Partial<SessionClaims>>(token, secret);
  if (!parsed) return null;
  try {
    if (typeof parsed.userId !== "string" || !parsed.userId || parsed.userId.length > 200) return null;
    if (parsed.provider !== "dev" && parsed.provider !== "chatgpt") return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now() / 1000) return null;
    return {
      userId: parsed.userId,
      provider: parsed.provider,
      compute: parsed.compute === true,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export async function readSession(request: Request, secret: string | null): Promise<SessionClaims | null> {
  if (!secret) return null;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return verifySession(token, secret);
}

export function sessionCookie(token: string, request: Request, maxAge = MAX_AGE_SEC): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(name: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

export async function applySession(
  response: Response,
  request: Request,
  claims: Omit<SessionClaims, "exp"> & { exp?: number },
  secret: string,
): Promise<Response> {
  const token = await signSession(
    {
      ...claims,
      exp: claims.exp ?? Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
    },
    secret,
  );
  const headers = new Headers(response.headers);
  headers.append("set-cookie", sessionCookie(token, request));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

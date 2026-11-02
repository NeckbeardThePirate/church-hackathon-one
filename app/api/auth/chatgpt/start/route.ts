import { env } from "cloudflare:workers";
import { authorizeUrl, callbackUrl, randomToken, type OauthPending } from "@/app/lib/server/chatgpt-auth";
import { isLoopbackRequest, OAUTH_COOKIE, readCookie, resolveSessionSecret, signBlob, verifyBlob } from "@/app/lib/server/session";

export const dynamic = "force-dynamic";

const CLIENT_COOKIE = "sb_oai_client";

function redirectError(request: Request, code: string): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("auth_error", code);
  return Response.redirect(url, 302);
}

export async function GET(request: Request): Promise<Response> {
  const secret = resolveSessionSecret(request, env.SESSION_SECRET);
  if (!secret) return redirectError(request, "session_secret");

  const registered = env.OPENAI_CLIENT_ID?.trim();
  const saved = readCookie(request, CLIENT_COOKIE);
  const savedClient = saved ? await verifyBlob<{ clientId?: string }>(saved, secret) : null;
  let clientId = registered || savedClient?.clientId || "";
  if (!clientId) {
    if (!isLoopbackRequest(request) || new URL(request.url).hostname !== "127.0.0.1") {
      return redirectError(request, "chatgpt_unconfigured");
    }
    clientId = "dynamic_agent_client";
  }

  const pending: OauthPending = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(48),
    redirectUri: callbackUrl(request),
    clientId,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  };
  const location = await authorizeUrl(pending, clientId !== "dynamic_agent_client");
  const headers = new Headers({ location });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  headers.append(
    "set-cookie",
    `${OAUTH_COOKIE}=${encodeURIComponent(await signBlob(pending, secret))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600${secure}`,
  );
  return new Response(null, { status: 302, headers });
}

import { env } from "cloudflare:workers";
import {
  authorizeUrl,
  callbackUrl,
  randomToken,
  resolveChatGptClientId,
  type OauthPending,
} from "@/app/lib/server/chatgpt-auth";
import { OAUTH_COOKIE, resolveSessionSecret, signBlob } from "@/app/lib/server/session";

export const dynamic = "force-dynamic";

function redirectError(request: Request, code: string): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("auth_error", code);
  return Response.redirect(url, 302);
}

export async function GET(request: Request): Promise<Response> {
  const secret = resolveSessionSecret(request, env.SESSION_SECRET);
  if (!secret) return redirectError(request, "session_secret");

  const clientId = await resolveChatGptClientId(request, {
    openAiClientId: env.OPENAI_CLIENT_ID,
    sessionSecret: secret,
  });
  if (!clientId) return redirectError(request, "chatgpt_unconfigured");

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

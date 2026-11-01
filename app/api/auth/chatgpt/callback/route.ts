import { env } from "cloudflare:workers";
import {
  exchangeCode,
  identityFromTokenResponse,
  verifyIdToken,
  type OauthPending,
} from "@/app/lib/server/chatgpt-auth";
import {
  applySession,
  clearCookie,
  OAUTH_COOKIE,
  readCookie,
  resolveSessionSecret,
  signBlob,
  verifyBlob,
} from "@/app/lib/server/session";
import { userWorkspaceStub } from "@/app/lib/server/user-workspace";

export const dynamic = "force-dynamic";

function redirectError(request: Request, code: string): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("auth_error", code);
  return Response.redirect(url, 302);
}

export async function GET(request: Request): Promise<Response> {
  const secret = resolveSessionSecret(request, env.SESSION_SECRET);
  if (!secret) return redirectError(request, "session_secret");
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return redirectError(request, "chatgpt_denied");

  const pendingToken = readCookie(request, OAUTH_COOKIE);
  const pending = pendingToken ? await verifyBlob<OauthPending>(pendingToken, secret) : null;
  if (!pending || pending.exp < Math.floor(Date.now() / 1000) || pending.state !== url.searchParams.get("state")) {
    return redirectError(request, "chatgpt_state");
  }
  const code = url.searchParams.get("code");
  if (!code) return redirectError(request, "chatgpt_failed");

  const issued = url.searchParams.get("client_id")?.trim();
  const clientId = pending.clientId === "dynamic_agent_client" ? issued || "" : pending.clientId;
  if (!clientId || clientId === "dynamic_agent_client") return redirectError(request, "chatgpt_client");
  if (issued && issued !== clientId) return redirectError(request, "chatgpt_client");

  try {
    const token = await exchangeCode({
      clientId,
      code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
      clientSecret: env.OPENAI_CLIENT_SECRET,
    });
    if (!token.id_token) return redirectError(request, "chatgpt_failed");
    const profile = await verifyIdToken(token.id_token, { nonce: pending.nonce, clientId });
    const identity = identityFromTokenResponse(token, profile, clientId);
    const userId = `oai_${identity.subject}`;
    try {
      await userWorkspaceStub(userId).setOauth(identity);
    } catch (error) {
      console.error("[auth] could not store ChatGPT credential:", error instanceof Error ? error.message : error);
    }
    const response = await applySession(
      Response.redirect(new URL("/", request.url), 302),
      request,
      { userId, provider: "chatgpt", compute: identity.compute },
      secret,
    );
    const headers = new Headers(response.headers);
    headers.append("set-cookie", clearCookie(OAUTH_COOKIE, request));
    const secure = url.protocol === "https:" ? "; Secure" : "";
    headers.append(
      "set-cookie",
      `sb_oai_client=${encodeURIComponent(await signBlob({ clientId }, secret))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${secure}`,
    );
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error("[auth] ChatGPT callback failed:", error instanceof Error ? error.message : error);
    return redirectError(request, "chatgpt_failed");
  }
}

import { clearCookie, OAUTH_COOKIE, SESSION_COOKIE } from "@/app/lib/server/session";

export const dynamic = "force-dynamic";

export function POST(request: Request): Response {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", clearCookie(SESSION_COOKIE, request));
  headers.append("set-cookie", clearCookie(OAUTH_COOKIE, request));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

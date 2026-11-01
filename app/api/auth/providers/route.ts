import { env } from "cloudflare:workers";
import { readClerkPublishableKey, readClerkSecretKey } from "@/app/lib/server/clerk-auth";
import { devAuthAllowed } from "@/app/lib/server/session";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const clerk = Boolean(readClerkSecretKey() && readClerkPublishableKey());
  return Response.json({
    clerk,
    chatgpt: true,
    dev: devAuthAllowed(request, env.DEV_AUTH),
  });
}

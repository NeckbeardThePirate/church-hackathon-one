import { env } from "cloudflare:workers";
import { readClerkSecretKey, resolveClerkPublishableKey } from "@/app/lib/server/clerk-auth";
import { devAuthAllowed } from "@/app/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const publishableKey = readClerkSecretKey() ? await resolveClerkPublishableKey() : undefined;
  return Response.json({
    clerk: Boolean(publishableKey),
    clerkPublishableKey: publishableKey ?? null,
    chatgpt: true,
    dev: devAuthAllowed(request, env.DEV_AUTH),
  });
}

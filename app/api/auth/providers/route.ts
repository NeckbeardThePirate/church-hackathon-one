import { env } from "cloudflare:workers";
import { resolveChatGptClientId } from "@/app/lib/server/chatgpt-auth";
import { readClerkSecretKey, resolveClerkPublishableKey } from "@/app/lib/server/clerk-auth";
import { devAuthAllowed, resolveSessionSecret } from "@/app/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const publishableKey = readClerkSecretKey() ? await resolveClerkPublishableKey() : undefined;
  const secret = resolveSessionSecret(request, env.SESSION_SECRET);
  const chatgptClientId = await resolveChatGptClientId(request, {
    openAiClientId: env.OPENAI_CLIENT_ID,
    sessionSecret: secret,
  });
  return Response.json(
    {
      clerk: Boolean(publishableKey),
      clerkPublishableKey: publishableKey ?? null,
      chatgpt: Boolean(chatgptClientId),
      dev: devAuthAllowed(request, env.DEV_AUTH),
    },
    { headers: { "cache-control": "private, max-age=300" } },
  );
}

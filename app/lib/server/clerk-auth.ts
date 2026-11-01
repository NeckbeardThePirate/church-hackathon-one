import { createClerkClient } from "@clerk/backend";
import { env } from "cloudflare:workers";
import { readSession, resolveSessionSecret } from "./session";

export type AuthContext = {
  userId: string;
  provider: "clerk" | "chatgpt" | "dev";
};

export function readClerkSecretKey(): string | undefined {
  const fromBinding = env.CLERK_SECRET_KEY;
  if (fromBinding && fromBinding !== "CLERK_SECRET_KEY") return fromBinding;
  // Vinext loads `.env.local` into process.env in local dev.
  const fromProcess = typeof process !== "undefined" ? process.env.CLERK_SECRET_KEY : undefined;
  return fromProcess?.trim() || undefined;
}

export function readClerkPublishableKey(): string | undefined {
  const fromBinding = env.CLERK_PUBLISHABLE_KEY;
  if (fromBinding && fromBinding !== "CLERK_PUBLISHABLE_KEY" && /^(pk_test_|pk_live_)/.test(fromBinding)) {
    return fromBinding;
  }
  if (typeof process === "undefined") return undefined;
  const fromProcess =
    process.env.CLERK_PUBLISHABLE_KEY?.trim() || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  return fromProcess && /^(pk_test_|pk_live_)/.test(fromProcess) ? fromProcess : undefined;
}

export async function requireUser(request: Request): Promise<AuthContext | Response> {
  try {
    const secret = resolveSessionSecret(request, env.SESSION_SECRET);
    const session = await readSession(request, secret);
    if (session) return { userId: session.userId, provider: session.provider };

    const secretKey = readClerkSecretKey();
    if (!secretKey) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }

    const publishableKey = readClerkPublishableKey();
    const clerk = createClerkClient({
      secretKey,
      ...(publishableKey ? { publishableKey } : {}),
    });

    const requestState = await clerk.authenticateRequest(request, {
      authorizedParties: [new URL(request.url).origin],
    });

    if (!requestState.isSignedIn) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }

    const auth = requestState.toAuth();
    if (!auth.userId) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }

    return { userId: auth.userId, provider: "clerk" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function withAuth(
  request: Request,
  handler: (auth: AuthContext) => Promise<Response>,
): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  return handler(auth);
}

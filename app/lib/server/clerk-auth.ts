import { createClerkClient } from "@clerk/backend";
import { env } from "cloudflare:workers";
import { readSession, resolveSessionSecret } from "./session";

export type AuthContext = {
  userId: string;
  provider: "clerk" | "chatgpt" | "dev";
};

export function readClerkSecretKey(): string | undefined {
  const fromBinding = env.CLERK_SECRET_KEY?.trim();
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

let derivedPublishableKey: Promise<string | undefined> | undefined;
let derivedFailedAt = 0;

/**
 * The publishable key is public (it encodes the Clerk frontend API host). When it is not
 * configured, derive it from the secret key so the Worker only needs CLERK_SECRET_KEY.
 */
export async function resolveClerkPublishableKey(): Promise<string | undefined> {
  const configured = readClerkPublishableKey();
  if (configured) return configured;
  const secretKey = readClerkSecretKey();
  if (!secretKey) return undefined;
  if (!derivedPublishableKey && Date.now() - derivedFailedAt < 60_000) return undefined;
  derivedPublishableKey ??= (async () => {
    try {
      const response = await fetch("https://api.clerk.com/v1/domains", {
        headers: { authorization: `Bearer ${secretKey}` },
      });
      if (!response.ok) {
        console.warn(`Clerk publishable key lookup failed: ${response.status}`);
        return undefined;
      }
      const body = (await response.json()) as { data?: { is_satellite?: boolean; frontend_api_url?: string }[] };
      const domain = body.data?.find((entry) => !entry.is_satellite && entry.frontend_api_url);
      if (!domain?.frontend_api_url) return undefined;
      const host = new URL(domain.frontend_api_url).host;
      const prefix = secretKey.startsWith("sk_live_") ? "pk_live_" : "pk_test_";
      return prefix + btoa(`${host}$`).replace(/=+$/, "");
    } catch {
      return undefined;
    }
  })();
  const key = await derivedPublishableKey;
  if (!key) {
    derivedPublishableKey = undefined;
    derivedFailedAt = Date.now();
  }
  return key;
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

    const publishableKey = await resolveClerkPublishableKey();
    if (!publishableKey) {
      // Clerk is not usable (bad secret or no key); treat as signed out instead of failing.
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }
    const clerk = createClerkClient({ secretKey, publishableKey });

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

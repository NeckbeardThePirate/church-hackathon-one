/**
 * `/api/auth/session` is checked only after we know whether Clerk is in use
 * and, when it is, after the Clerk client leaves its initial load.
 * An earlier call 401s: the session cookie is written when Clerk finishes
 * initializing, and the gate also mounts a second time when that provider appears.
 * One page shares a single in-flight request so a StrictMode effect replay
 * does not send another. A signed-in result stays on the app view, so a later
 * Clerk update does not swap out the workspace tree.
 */

export type AuthSessionStatus = "in" | "out";

export type AuthSessionGateInput = {
  /** Publishable-key lookup has finished (key present or confirmed absent). */
  configReady: boolean;
  /** A Clerk publishable key is configured. */
  hasClerk: boolean;
  /** Clerk client status is ready, degraded, or error — not the initial load. */
  clerkClientReady: boolean;
  session: AuthSessionStatus | "loading";
};

export type AuthGateView = "loading" | "app" | "choices" | "clerk";

/** Clerk status values that mean the initial client load has finished. */
export function isClerkClientSettled(status: string | null | undefined): boolean {
  return status === "ready" || status === "degraded" || status === "error";
}

export function shouldRequestAuthSession(input: AuthSessionGateInput): boolean {
  if (input.session !== "loading") return false;
  if (!input.configReady) return false;
  if (input.hasClerk && !input.clerkClientReady) return false;
  return true;
}

/** Signed-in wins over every loading and sign-in branch so the app is not unmounted. */
export function authGateView(input: { session: AuthSessionStatus | "loading"; hasClerk: boolean }): AuthGateView {
  if (input.session === "in") return "app";
  if (input.session === "out") return input.hasClerk ? "clerk" : "choices";
  return "loading";
}

export function createAuthSessionLoader(
  request: () => Promise<AuthSessionStatus>,
): () => Promise<AuthSessionStatus> {
  let pending: Promise<AuthSessionStatus> | null = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve()
        .then(request)
        .catch(() => "out" as const)
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}

export async function requestAuthSession(fetchImpl: typeof fetch = fetch): Promise<AuthSessionStatus> {
  try {
    const response = await fetchImpl("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    return response.ok ? "in" : "out";
  } catch {
    return "out";
  }
}

const sharedAuthSession = createAuthSessionLoader(() => requestAuthSession());

export function loadAuthSession(): Promise<AuthSessionStatus> {
  return sharedAuthSession();
}

/** Effect body. Returns a cleanup that ignores a stale resolution after unmount. */
export function bindAuthSessionRequest(
  shouldFetch: boolean,
  load: () => Promise<AuthSessionStatus>,
  onStatus: (status: AuthSessionStatus) => void,
): () => void {
  if (!shouldFetch) return () => {};
  let cancelled = false;
  load().then(
    (status) => {
      if (!cancelled) onStatus(status);
    },
    () => {
      if (!cancelled) onStatus("out");
    },
  );
  return () => {
    cancelled = true;
  };
}

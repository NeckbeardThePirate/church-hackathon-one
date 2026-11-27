"use client";

import { ClerkLoading, RedirectToSignIn, Show, useClerk } from "@clerk/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  authGateView,
  bindAuthSessionRequest,
  isClerkClientSettled,
  loadAuthSession,
  shouldRequestAuthSession,
  type AuthSessionStatus,
} from "./auth-session-gate";
import { useClerkKey } from "./ClerkAppProvider";
import { SignInChoices } from "./SignInChoices";

function AuthLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] text-base text-[var(--ink-muted)]">
      Loading…
    </div>
  );
}

function SessionGate({
  children,
  configReady,
  hasClerk,
  clerkClientReady,
}: {
  children: ReactNode;
  configReady: boolean;
  hasClerk: boolean;
  clerkClientReady: boolean;
}) {
  const [session, setSession] = useState<AuthSessionStatus | "loading">("loading");
  const shouldFetch = shouldRequestAuthSession({ configReady, hasClerk, clerkClientReady, session });

  useEffect(() => bindAuthSessionRequest(shouldFetch, loadAuthSession, setSession), [shouldFetch]);

  const view = authGateView({ session, hasClerk });
  if (view === "app") return <>{children}</>;
  if (view === "choices") {
    return (
      <div className="safe-area-x flex min-h-dvh items-center justify-center bg-[var(--canvas)] px-4 py-10 [scrollbar-gutter:stable]">
        <SignInChoices />
      </div>
    );
  }
  if (view === "clerk") {
    return (
      <>
        <ClerkLoading>
          <AuthLoading />
        </ClerkLoading>
        <Show when="signed-in" fallback={<RedirectToSignIn />}>
          {children}
        </Show>
      </>
    );
  }
  return <AuthLoading />;
}

function ClerkSessionGate({ children, configReady }: { children: ReactNode; configReady: boolean }) {
  const clerk = useClerk();
  return (
    <SessionGate configReady={configReady} hasClerk clerkClientReady={isClerkClientSettled(clerk.status)}>
      {children}
    </SessionGate>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { key: publishableKey, ready: configReady } = useClerkKey();
  if (publishableKey) return <ClerkSessionGate configReady={configReady}>{children}</ClerkSessionGate>;
  return (
    <SessionGate configReady={configReady} hasClerk={false} clerkClientReady={false}>
      {children}
    </SessionGate>
  );
}

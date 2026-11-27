"use client";

import { ClerkLoading, Show, useClerk } from "@clerk/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  bindAuthSessionRequest,
  isClerkClientSettled,
  loadAuthSession,
  shouldRequestAuthSession,
  type AuthSessionStatus,
} from "./auth-session-gate";
import { useClerkKey } from "./ClerkAppProvider";
import { GuestPreview } from "./GuestPreview";

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
  publishableKey,
}: {
  children: ReactNode;
  configReady: boolean;
  hasClerk: boolean;
  clerkClientReady: boolean;
  publishableKey: string | null;
}) {
  const [session, setSession] = useState<AuthSessionStatus | "loading">("loading");
  const shouldFetch = shouldRequestAuthSession({ configReady, hasClerk, clerkClientReady, session });

  useEffect(() => bindAuthSessionRequest(shouldFetch, loadAuthSession, setSession), [shouldFetch]);

  // Signed-in stays mounted if Clerk's status flickers. The workspace tree is not remounted.
  if (session === "in") return <>{children}</>;
  if (session === "loading" || !configReady || (hasClerk && !clerkClientReady)) return <AuthLoading />;
  if (!publishableKey) return <GuestPreview />;

  return (
    <>
      <ClerkLoading>
        <AuthLoading />
      </ClerkLoading>
      <Show when="signed-in" fallback={<GuestPreview />}>
        {children}
      </Show>
    </>
  );
}

function ClerkSessionGate({
  children,
  configReady,
  publishableKey,
}: {
  children: ReactNode;
  configReady: boolean;
  publishableKey: string;
}) {
  const clerk = useClerk();
  return (
    <SessionGate
      configReady={configReady}
      hasClerk
      clerkClientReady={isClerkClientSettled(clerk.status)}
      publishableKey={publishableKey}
    >
      {children}
    </SessionGate>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { key: publishableKey, ready: configReady } = useClerkKey();
  if (publishableKey) {
    return (
      <ClerkSessionGate configReady={configReady} publishableKey={publishableKey}>
        {children}
      </ClerkSessionGate>
    );
  }
  return (
    <SessionGate configReady={configReady} hasClerk={false} clerkClientReady={false} publishableKey={null}>
      {children}
    </SessionGate>
  );
}

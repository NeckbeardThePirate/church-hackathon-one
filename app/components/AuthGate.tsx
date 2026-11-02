"use client";

import { ClerkLoading, RedirectToSignIn, Show } from "@clerk/react";
import { useEffect, useState, type ReactNode } from "react";
import { useClerkKey } from "./ClerkAppProvider";
import { SignInChoices } from "./SignInChoices";

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] text-sm text-[var(--ink-muted)]">
      Loading…
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { key: publishableKey, ready: clerkReady } = useClerkKey();
  const [session, setSession] = useState<"loading" | "in" | "out">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => {
        if (!cancelled) setSession(response.ok ? "in" : "out");
      })
      .catch(() => {
        if (!cancelled) setSession("out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (session === "loading" || !clerkReady) return <AuthLoading />;
  if (session === "in") return <>{children}</>;

  if (!publishableKey) return <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-6 [scrollbar-gutter:stable]"><SignInChoices /></div>;

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

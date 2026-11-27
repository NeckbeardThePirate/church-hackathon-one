"use client";

import { ClerkLoading, Show } from "@clerk/react";
import { useEffect, useState, type ReactNode } from "react";
import { useClerkKey } from "./ClerkAppProvider";
import { GuestPreview } from "./GuestPreview";

function AuthLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] text-base text-[var(--ink-muted)]">
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

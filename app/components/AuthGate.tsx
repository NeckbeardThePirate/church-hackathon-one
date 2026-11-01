"use client";

import { ClerkLoading, RedirectToSignIn, Show } from "@clerk/react";
import type { ReactNode } from "react";

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] text-sm text-[var(--ink-muted)]">
      Loading…
    </div>
  );
}

function AuthSetupRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-6 [scrollbar-gutter:stable]">
      <div className="max-w-md rounded-xl border border-[var(--line)] bg-[var(--sidebar)] p-6 text-[var(--ink)]">
        <h1 className="text-lg font-semibold">Clerk keys required</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
          Copy keys from the{" "}
          <a
            className="text-[var(--accent)] underline-offset-2 hover:underline"
            href="https://dashboard.clerk.com/~/api-keys"
            target="_blank"
            rel="noopener noreferrer"
          >
            Clerk Dashboard
          </a>{" "}
          into <code className="text-[var(--ink)]">.env.local</code> and{" "}
          <code className="text-[var(--ink)]">.dev.vars</code>, then restart{" "}
          <code className="text-[var(--ink)]">npm run dev</code>.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-[var(--canvas)] p-3 text-xs text-[var(--ink-muted)] [scrollbar-gutter:stable]">
          {`# .env.local
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...

# .dev.vars
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...`}
        </pre>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return <AuthSetupRequired />;
  }

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

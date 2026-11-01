"use client";

import { ClerkProvider } from "@clerk/react";
import { dark } from "@clerk/themes";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** Build-time key if set, otherwise the Worker serves it from /api/auth/providers. */
const ClerkKeyContext = createContext<{ key: string | null; ready: boolean }>({ key: null, ready: false });

export function useClerkKey() {
  return useContext(ClerkKeyContext);
}

export function ClerkAppProvider({ children }: { children: ReactNode }) {
  const buildKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || null;
  const [state, setState] = useState<{ key: string | null; ready: boolean }>({ key: buildKey, ready: Boolean(buildKey) });

  useEffect(() => {
    if (buildKey) return;
    let cancelled = false;
    fetch("/api/auth/providers", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const key = (body as { clerkPublishableKey?: string | null } | null)?.clerkPublishableKey;
        if (!cancelled) setState({ key: key && /^pk_(test|live)_/.test(key) ? key : null, ready: true });
      })
      .catch(() => {
        if (!cancelled) setState({ key: null, ready: true });
      });
    return () => {
      cancelled = true;
    };
  }, [buildKey]);

  if (!state.key) {
    return <ClerkKeyContext.Provider value={state}>{children}</ClerkKeyContext.Provider>;
  }

  return (
    <ClerkKeyContext.Provider value={state}>
      <ClerkProvider
        publishableKey={state.key}
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
        afterSignOutUrl="/"
        appearance={{
          theme: dark,
          variables: {
            colorBackground: "#191919",
            colorInput: "#202020",
            colorPrimary: "#c9b896",
          },
        }}
      >
        {children}
      </ClerkProvider>
    </ClerkKeyContext.Provider>
  );
}

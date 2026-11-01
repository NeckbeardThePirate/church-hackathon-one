"use client";

import { ClerkProvider } from "@clerk/react";
import { dark } from "@clerk/themes";
import type { ReactNode } from "react";

export function ClerkAppProvider({ children }: { children: ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
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
  );
}

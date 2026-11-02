"use client";

import { SignIn } from "@clerk/react";
import { useClerkKey } from "../../components/ClerkAppProvider";
import { SignInChoices } from "../../components/SignInChoices";

export default function SignInPage() {
  const { key: publishableKey } = useClerkKey();
  return (
    <div className="safe-area-x flex min-h-dvh items-center justify-center bg-[var(--canvas)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="flex w-full max-w-[min(100%,420px)] flex-col gap-6">
        {publishableKey ? <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" /> : null}
        <SignInChoices />
      </div>
    </div>
  );
}

"use client";

import { SignIn } from "@clerk/react";
import { useClerkKey } from "../../components/ClerkAppProvider";
import { SignInChoices } from "../../components/SignInChoices";

export default function SignInPage() {
  const { key: publishableKey } = useClerkKey();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[var(--canvas)] px-4 py-10 [scrollbar-gutter:stable]">
      {publishableKey ? <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" /> : null}
      <SignInChoices />
    </div>
  );
}

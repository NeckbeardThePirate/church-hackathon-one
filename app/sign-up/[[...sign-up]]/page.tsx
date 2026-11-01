"use client";

import { SignUp } from "@clerk/react";
import { useClerkKey } from "../../components/ClerkAppProvider";
import { SignInChoices } from "../../components/SignInChoices";

export default function SignUpPage() {
  const { key: publishableKey } = useClerkKey();
  if (!publishableKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4 py-10 [scrollbar-gutter:stable]">
        <SignInChoices />
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4 py-10 [scrollbar-gutter:stable]">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </div>
  );
}

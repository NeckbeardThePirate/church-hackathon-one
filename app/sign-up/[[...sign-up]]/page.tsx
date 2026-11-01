"use client";

import { SignUp } from "@clerk/react";
import { SignInChoices } from "../../components/SignInChoices";

export default function SignUpPage() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
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

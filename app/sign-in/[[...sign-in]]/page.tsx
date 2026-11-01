"use client";

import { SignIn } from "@clerk/react";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4 py-10 [scrollbar-gutter:stable]">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </div>
  );
}

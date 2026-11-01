"use client";

import { SignUp } from "@clerk/react";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4 py-10 [scrollbar-gutter:stable]">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </div>
  );
}

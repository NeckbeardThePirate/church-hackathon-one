"use client";

import { SignUp } from "@clerk/react";
import { AuthChrome } from "../../components/AuthChrome";
import { useClerkKey } from "../../components/ClerkAppProvider";
import { SignInChoices } from "../../components/SignInChoices";

export default function SignUpPage() {
  const { key: publishableKey } = useClerkKey();
  if (!publishableKey) {
    return (
      <AuthChrome>
        <SignInChoices />
      </AuthChrome>
    );
  }
  return (
    <AuthChrome>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </AuthChrome>
  );
}

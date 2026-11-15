"use client";

import { SignIn } from "@clerk/react";
import { AuthChrome } from "../../components/AuthChrome";
import { useClerkKey } from "../../components/ClerkAppProvider";
import { SignInChoices } from "../../components/SignInChoices";

export default function SignInPage() {
  const { key: publishableKey } = useClerkKey();
  return (
    <AuthChrome>
      {publishableKey ? <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" /> : null}
      <SignInChoices />
    </AuthChrome>
  );
}

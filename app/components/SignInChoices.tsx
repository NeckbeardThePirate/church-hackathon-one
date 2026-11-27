"use client";

import { useEffect, useState } from "react";
import { NO_AUTH_PROVIDERS, readAuthProviders, signInChoiceVisibility, type AuthProviders } from "./sign-in-choices";
import { StudyLamp } from "./StudyLamp";

const ERRORS: Record<string, string> = {
  chatgpt_unconfigured:
    "Sign in with ChatGPT needs a registered OpenAI client on this host. Set OPENAI_CLIENT_ID, or open the app at http://127.0.0.1 so the open-source registration flow can run.",
  chatgpt_denied: "ChatGPT sign-in was cancelled.",
  chatgpt_state: "That sign-in attempt expired. Try again.",
  chatgpt_client: "ChatGPT did not return a client id for this registration.",
  chatgpt_failed: "ChatGPT sign-in did not finish. Try again.",
  chatgpt_client_secret:
    "ChatGPT rejected this sign-in and OPENAI_CLIENT_SECRET is not set. A public PKCE client does not need it. A confidential OpenAI client does.",
  session_secret: "Set SESSION_SECRET before signing in on a public host.",
};

export function SignInChoices({ compact = false }: { compact?: boolean }) {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("auth_error");
    if (code) setError(ERRORS[code] ?? "Sign-in failed.");
    void fetch("/api/auth/providers", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setProviders(readAuthProviders(body)))
      .catch(() => setProviders(NO_AUTH_PROVIDERS));
  }, []);

  async function continueLocally() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/dev", { method: "POST", credentials: "same-origin" });
      if (!response.ok) {
        setError("Local sign-in is only available on this computer while DEV_AUTH=1.");
        setPending(false);
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Could not start a local session.");
      setPending(false);
    }
  }

  const visibility = signInChoiceVisibility(providers, Boolean(error));
  const showActions = visibility.chatgpt || visibility.dev;
  // Clerk renders its own card. This one is the ChatGPT / loopback alternative.
  if (visibility.pending || visibility.hidden) return null;

  return (
    <div className={`mx-auto w-full min-w-0 ${compact ? "" : "max-w-md"}`}>
      <div className="rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-5 py-5 text-[var(--ink)] sm:px-6 sm:py-6">
        <h1 className="study-serif break-words text-2xl tracking-[-0.02em]">StudyBuddy</h1>
        <p className="mt-2 break-words text-sm leading-relaxed text-[var(--ink-muted)]">
          Learn paths cited to Scripture, the confessions, and the church fathers.
        </p>
        {showActions ? (
          <div className="mt-6 flex flex-col gap-3">
            {visibility.chatgpt ? (
              <a
                href="/api/auth/chatgpt/start"
                className="flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 text-balance text-center text-base font-medium leading-snug text-[#1c1a16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                Continue with ChatGPT
              </a>
            ) : null}
            {visibility.dev ? (
              <button
                type="button"
                onClick={() => void continueLocally()}
                disabled={pending}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-4 py-2.5 text-balance text-center text-base leading-snug text-[var(--ink)] hover:bg-[var(--sidebar-active)] disabled:opacity-50"
              >
                {pending ? <StudyLamp size={22} live /> : null}
                {pending ? "Opening the study…" : "Continue on this computer"}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="mt-5 break-words text-sm leading-relaxed text-[#c0533f]">{error}</p> : null}
        <p className="mt-5 break-words text-xs leading-relaxed text-[var(--ink-muted)]">
          Learn paths run on Workers AI.
          {visibility.chatgpt
            ? " If you grant ChatGPT plan usage, it is stored for your account and used only when Workers AI fails and a fallback model is configured."
            : null}
        </p>
      </div>
    </div>
  );
}

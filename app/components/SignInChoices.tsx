"use client";

import { useEffect, useState } from "react";

const ERRORS: Record<string, string> = {
  chatgpt_unconfigured:
    "Sign in with ChatGPT needs a registered OpenAI client on this host. Set OPENAI_CLIENT_ID, or open the app at http://127.0.0.1 so the open-source registration flow can run.",
  chatgpt_denied: "ChatGPT sign-in was cancelled.",
  chatgpt_state: "That sign-in attempt expired. Try again.",
  chatgpt_client: "ChatGPT did not return a client id for this registration.",
  chatgpt_failed: "ChatGPT sign-in did not finish. Try again.",
  session_secret: "Set SESSION_SECRET before signing in on a public host.",
};

type Providers = { clerk: boolean; chatgpt: boolean; dev: boolean };

export function SignInChoices({ compact = false }: { compact?: boolean }) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("auth_error");
    if (code) setError(ERRORS[code] ?? "Sign-in failed.");
    void fetch("/api/auth/providers", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const providers = body as Providers | null;
        if (providers && typeof providers === "object") setProviders(providers);
      })
      .catch(() => setProviders({ clerk: false, chatgpt: true, dev: false }));
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

  return (
    <div className={`w-full ${compact ? "" : "max-w-md"} [scrollbar-gutter:stable]`}>
      <div className="safe-area-x rounded-xl border border-[var(--line)] bg-[var(--sidebar)] p-5 sm:p-6 text-[var(--ink)]">
        <h1 className="font-serif text-2xl tracking-[-0.02em]">StudyBuddy</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
          Learn paths cited to Scripture, the confessions, and the church fathers.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <a
            href="/api/auth/chatgpt/start"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 text-center text-base font-medium text-[#1c1a16]"
          >
            Continue with ChatGPT
          </a>
          {providers?.dev ? (
            <button
              type="button"
              onClick={() => void continueLocally()}
              disabled={pending}
              className="min-h-11 rounded-lg border border-[var(--line)] px-4 py-2.5 text-base text-[var(--ink)] hover:bg-[var(--sidebar-active)] disabled:opacity-50"
            >
              {pending ? "Signing in…" : "Continue on this computer"}
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-4 text-sm text-[#c0533f]">{error}</p> : null}
        <p className="mt-4 text-xs leading-relaxed text-[var(--ink-muted)]">
          Learn paths run on Workers AI. If you grant ChatGPT plan usage, it is stored for your account and used only when Workers AI fails and a fallback model is configured.
        </p>
      </div>
    </div>
  );
}

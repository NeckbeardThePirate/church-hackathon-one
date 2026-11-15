import type { ReactNode } from "react";

/** Auth pages share the app bar and canvas so Clerk does not sit on a blank page. */
export function AuthChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <header className="safe-area-top safe-area-x sticky top-0 z-50 flex h-12 shrink-0 items-center border-b border-[var(--line)] bg-[var(--sidebar)] px-3">
        <a href="/" className="min-w-0 truncate text-sm font-medium text-[var(--ink)]">
          StudyBuddy
        </a>
      </header>
      <main className="safe-area-x safe-area-bottom flex flex-1 flex-col overflow-y-auto px-4 py-8 [scrollbar-gutter:stable]">
        <div className="my-auto flex w-full max-w-[min(100%,420px)] flex-col gap-6 self-center">{children}</div>
      </main>
    </div>
  );
}

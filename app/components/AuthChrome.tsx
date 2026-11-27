import type { ReactNode } from "react";

/** Auth pages share the app bar and canvas so Clerk does not sit on a blank page. */
export function AuthChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <header className="safe-area-top sticky top-0 z-50 flex h-12 shrink-0 items-center border-b border-[var(--line)] bg-[var(--sidebar)] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))]">
        <a href="/" className="min-w-0 truncate text-sm font-medium text-[var(--ink)]">
          StudyBuddy
        </a>
      </header>
      <main className="safe-area-bottom flex flex-1 flex-col overflow-y-auto py-8 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] [scrollbar-gutter:stable_both-edges]">
        <div className="my-auto flex w-full max-w-[min(100%,24rem)] flex-col gap-6 self-center">{children}</div>
      </main>
    </div>
  );
}

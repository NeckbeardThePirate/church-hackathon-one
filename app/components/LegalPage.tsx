import type { ReactNode } from "react";
import { LegalLinks } from "./LegalLinks";
import { StudyLamp } from "./StudyLamp";

const serif = { fontFamily: "var(--font-serif), Georgia, 'Iowan Old Style', serif" } as const;

const mailClass =
  "font-medium text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

export function MailLink() {
  return (
    <a href="mailto:judah@hellands.com" className={mailClass}>
      judah@hellands.com
    </a>
  );
}

/** Public legal chrome. These routes render with no session and no sign-in redirect. */
export function LegalPage({
  current,
  kicker,
  title,
  updated,
  children,
}: {
  current: "privacy" | "terms";
  kicker: string;
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <header className="safe-area-top sticky top-0 z-50 flex h-12 shrink-0 items-center border-b border-[var(--line)] bg-[var(--sidebar)] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))]">
        <a href="/" className="min-w-0 truncate text-sm font-medium text-[var(--ink)]">
          StudyBuddy
        </a>
      </header>
      <main className="flex-1 overflow-x-clip overflow-y-auto [scrollbar-gutter:stable] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]">
        <article className="relative mx-auto w-full max-w-2xl py-10 sm:py-14">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-6 left-0 h-40 w-40 rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] blur-3xl"
          />
          <div className="relative">
            <StudyLamp size={44} live={false} />
            <p className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">{kicker}</p>
            <h1 className="mt-2 text-4xl leading-[1.12] tracking-[-0.02em] text-[var(--ink)]" style={serif}>
              {title}
            </h1>
            <p className="mt-3 text-sm text-[var(--ink-muted)]">Updated {updated}</p>
            <div className="mt-8 space-y-8 break-words">{children}</div>
            <p className="mt-10">
              <a href="/" className={mailClass}>
                Back to StudyBuddy
              </a>
            </p>
            <footer className="safe-area-bottom mt-8 border-t border-[var(--line)] pt-4">
              <LegalLinks current={current} />
            </footer>
          </div>
        </article>
      </main>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--ink)]">{title}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-[var(--ink)]">{children}</div>
    </section>
  );
}

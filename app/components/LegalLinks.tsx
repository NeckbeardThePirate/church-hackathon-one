type Current = "privacy" | "terms";

const linkClass =
  "rounded-sm underline-offset-2 hover:text-[var(--ink)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

/** Subtle Privacy / Terms links. These routes stay public while signed out. */
export function LegalLinks({ current, className = "" }: { current?: Current; className?: string }) {
  return (
    <nav
      aria-label="Legal"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-muted)] ${className}`}
    >
      <a
        href="/privacy"
        aria-current={current === "privacy" ? "page" : undefined}
        className={current === "privacy" ? `${linkClass} text-[var(--ink)]` : linkClass}
      >
        Privacy
      </a>
      <span aria-hidden="true">·</span>
      <a
        href="/terms"
        aria-current={current === "terms" ? "page" : undefined}
        className={current === "terms" ? `${linkClass} text-[var(--ink)]` : linkClass}
      >
        Terms
      </a>
    </nav>
  );
}

"use client";

import { STARTER_PATHS, type StarterPathId } from "../lib/learn/starters";
import { SourceNote } from "./SourceNote";

type Props = {
  busyId: StarterPathId | null;
  error: string | null;
  onChoose: (id: StarterPathId) => void;
};

export function StarterPathCard({ busyId, error, onChoose }: Props) {
  return (
    <section aria-label="Try a ready-made starter path" className="mx-auto w-full max-w-[640px] px-4 pt-4 sm:px-10 sm:pt-8">
      <div className="rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[var(--sidebar)] px-4 py-4 sm:px-5 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Empty workspace</p>
        <h2 className="mt-2 break-words text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)] sm:text-[1.75rem]">
          Try a ready-made starter path
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
          Open a finished path in one click. It already has lessons, scripture and historical citations, a practice lesson,
          and a quiz. It is saved into this workspace and opens immediately.
        </p>
        <SourceNote place="home" compact />
        <ul className="mt-4 flex flex-col gap-2">
          {STARTER_PATHS.map((starter) => {
            const busy = busyId === starter.id;
            return (
              <li key={starter.id}>
                <button
                  type="button"
                  disabled={busyId !== null}
                  aria-busy={busy}
                  onClick={() => onChoose(starter.id)}
                  className="flex min-h-12 w-full flex-col items-start justify-center gap-0.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-4 py-3 text-left text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_70%,var(--line))] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="break-words text-sm font-medium">{busy ? "Opening…" : `Open ${starter.title}`}</span>
                  <span className="break-words text-xs leading-snug text-[var(--ink-muted)]">{starter.detail}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[#c0533f]">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

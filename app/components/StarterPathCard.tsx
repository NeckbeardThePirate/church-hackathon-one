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
    <section aria-label="Try a ready-made starter path" className="w-full">
      <ul className="flex flex-col gap-2">
        {STARTER_PATHS.map((starter) => {
          const busy = busyId === starter.id;
          return (
            <li key={starter.id}>
              <button
                type="button"
                disabled={busyId !== null}
                aria-busy={busy}
                onClick={() => onChoose(starter.id)}
                className="flex min-h-12 w-full flex-col items-start justify-center gap-0.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-4 py-3 text-left text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_70%,var(--line))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="break-words text-sm font-medium">{busy ? "Opening…" : `Open ${starter.title}`}</span>
                <span className="break-words text-xs leading-snug text-[var(--ink-muted)]">{starter.detail}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <SourceNote place="home" compact />
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#c0533f]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

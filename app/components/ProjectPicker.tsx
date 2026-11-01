"use client";

import { PROJECT_KIND_OPTIONS, type ProjectKind } from "../lib/projects";

type ProjectPickerProps = {
  onSelect: (kind: ProjectKind) => void;
};

export function ProjectPicker({ onSelect }: ProjectPickerProps) {
  return (
    <section className="mx-auto flex w-full max-w-[640px] flex-col gap-10 px-6 pb-24 pt-16 sm:px-10 sm:pt-24">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">New project</p>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[var(--ink)] sm:text-4xl">
          What are you working on?
        </h1>
        <p className="max-w-md text-base leading-relaxed text-[var(--ink-muted)]">
          Choose a type to open a fresh note. You can switch between saved projects anytime from the sidebar.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-1">
        {PROJECT_KIND_OPTIONS.map((option) => (
          <li key={option.kind}>
            <button
              type="button"
              onClick={() => onSelect(option.kind)}
              className="group flex w-full flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-5 py-4 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:bg-[var(--sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
            >
              <span className="text-lg font-medium text-[var(--ink)]">{option.label}</span>
              <span className="text-sm leading-relaxed text-[var(--ink-muted)] group-hover:text-[color-mix(in_srgb,var(--ink-muted)_70%,var(--ink))]">
                {option.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

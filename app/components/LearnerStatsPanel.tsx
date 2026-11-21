"use client";

import type { LessonMastery } from "../lib/learn/learner-stats";

type Props = {
  xp: number;
  streak: number;
  lessons?: LessonMastery[];
  /** Shown on the compact strip for the lesson that is open. */
  masteryPercent?: number | null;
  variant?: "sidebar" | "strip";
};

export function LearnerStatsPanel({ xp, streak, lessons = [], masteryPercent = null, variant = "sidebar" }: Props) {
  if (variant === "strip") {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ink-muted)]" aria-label="Learner stats">
        <span>
          XP <strong className="tabular-nums font-semibold text-[var(--ink)]">{xp}</strong>
        </span>
        <span>
          Streak <strong className="tabular-nums font-semibold text-[var(--ink)]">{streak}</strong>
          {streak === 1 ? " day" : " days"}
        </span>
        {masteryPercent != null ? (
          <span>
            Mastery <strong className="tabular-nums font-semibold text-[var(--ink)]">{masteryPercent}%</strong>
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <section
      aria-label="Learner stats"
      className="mb-3 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--canvas)_35%,var(--sidebar))] px-2.5 py-2"
    >
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">XP</span>
        <span className="tabular-nums text-[var(--ink)]">{xp}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">Streak</span>
        <span className="tabular-nums text-[var(--ink)]">
          {streak} {streak === 1 ? "day" : "days"}
        </span>
      </div>
      {lessons.length ? (
        <ol className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t border-[var(--line)] pt-2 [scrollbar-gutter:stable]">
          {lessons.map((lesson) => (
            <li key={lesson.id} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-[var(--ink-muted)]">
                {lesson.order}. {lesson.title}
              </span>
              <span className="shrink-0 tabular-nums text-[var(--ink)]">{lesson.percent}%</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

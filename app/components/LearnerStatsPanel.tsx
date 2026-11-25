"use client";

import { statsFigures, type DailyGoalStatus, type LessonMastery } from "../lib/learn/learner-stats";
import { DailyGoalBar } from "./ProgressDashboard";

type Props = {
  xp: number;
  streak: number;
  /** True until the workspace stats request finishes. Numbers stay hidden so a reload does not flash 0. */
  pending?: boolean;
  lessons?: LessonMastery[];
  /** Shown on the compact strip for the lesson that is open. */
  masteryPercent?: number | null;
  goal?: DailyGoalStatus | null;
  nextLabel?: string | null;
  onNext?: () => void;
  variant?: "sidebar" | "strip";
};

export function LearnerStatsPanel({
  xp,
  streak,
  pending = false,
  lessons = [],
  masteryPercent = null,
  goal = null,
  nextLabel = null,
  onNext,
  variant = "sidebar",
}: Props) {
  const figures = statsFigures(pending ? null : { xp, streak });
  if (variant === "strip") {
    return (
      <div
        className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ink-muted)]"
        aria-label="Learner stats"
        aria-busy={figures.busy}
      >
        <span>
          XP <strong className="tabular-nums font-semibold text-[var(--ink)]">{figures.xp}</strong>
        </span>
        <span>
          Streak <strong className="tabular-nums font-semibold text-[var(--ink)]">{figures.streak}</strong>
          {figures.busy ? "" : streak === 1 ? " day" : " days"}
        </span>
        {masteryPercent != null ? (
          <span>
            Mastery <strong className="tabular-nums font-semibold text-[var(--ink)]">{masteryPercent}%</strong>
          </span>
        ) : null}
        {goal ? (
          <div className="min-w-[8rem] flex-1">
            <DailyGoalBar {...goal} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      aria-label="Learner stats"
      aria-busy={figures.busy}
      className="mb-3 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--canvas)_35%,var(--sidebar))] px-2.5 py-2"
    >
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">XP</span>
        <span className="tabular-nums text-[var(--ink)]">{figures.xp}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">Streak</span>
        <span className="tabular-nums text-[var(--ink)]">
          {figures.busy ? figures.streak : `${figures.streak} ${streak === 1 ? "day" : "days"}`}
        </span>
      </div>
      {goal ? (
        <div className="mt-2 border-t border-[var(--line)] pt-2">
          <DailyGoalBar {...goal} />
        </div>
      ) : null}
      {nextLabel && onNext ? (
        <button
          type="button"
          onClick={onNext}
          className="mt-2 flex min-h-11 w-full items-center rounded-md border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] px-2 py-2 text-left text-xs font-medium text-[var(--ink)]"
        >
          <span className="min-w-0 flex-1">{nextLabel}</span>
        </button>
      ) : null}
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

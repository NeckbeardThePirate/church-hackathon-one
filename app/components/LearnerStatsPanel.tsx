"use client";

import { statsFigures, type DailyGoalStatus, type LessonMastery } from "../lib/learn/learner-stats";
import { DailyGoalBar } from "./ProgressDashboard";
import { StudyShimmer } from "./StudyLamp";

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
        <span className="inline-flex min-w-0 items-center gap-1.5">
          XP{" "}
          {figures.busy ? (
            <StudyShimmer className="inline-block h-3 w-8" />
          ) : (
            <strong className="tabular-nums font-semibold text-[var(--ink)]">{figures.xp}</strong>
          )}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          Streak{" "}
          {figures.busy ? (
            <StudyShimmer className="inline-block h-3 w-8" />
          ) : (
            <strong className="tabular-nums font-semibold text-[var(--ink)]">
              {figures.streak}
              {streak === 1 ? " day" : " days"}
            </strong>
          )}
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
      className="mb-3 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--canvas)_35%,var(--sidebar))] px-3 py-2.5"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">XP</p>
          {figures.busy ? (
            <StudyShimmer className="mt-1.5 h-3.5 w-8" />
          ) : (
            <p className="mt-1 text-sm font-semibold tabular-nums leading-none text-[var(--ink)]">{figures.xp}</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Streak</p>
          {figures.busy ? (
            <StudyShimmer className="mt-1.5 h-3.5 w-12" />
          ) : (
            <p className="mt-1 truncate text-sm font-semibold tabular-nums leading-none text-[var(--ink)]">
              {figures.streak} {streak === 1 ? "day" : "days"}
            </p>
          )}
        </div>
      </div>
      {goal ? (
        <div className="mt-2.5 border-t border-[var(--line)] pt-2.5">
          <DailyGoalBar {...goal} />
        </div>
      ) : null}
      {nextLabel && onNext ? (
        <button
          type="button"
          onClick={onNext}
          className="mt-2.5 flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--sidebar-active)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <span className="min-w-0 flex-1 truncate">{nextLabel}</span>
          <span aria-hidden className="shrink-0 text-[var(--ink-muted)]">
            →
          </span>
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

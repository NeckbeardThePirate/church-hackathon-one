"use client";

import { statsFigures, type DailyGoalStatus } from "../lib/learn/learner-stats";
import type { NextAction, PathSummary } from "../lib/learn/progress-dashboard";
import { SourceNote } from "./SourceNote";

export function DailyGoalBar({ earned, target, met, percent }: DailyGoalStatus) {
  const shown = Math.min(earned, target);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">Daily goal</span>
        <span className="tabular-nums text-[var(--ink)]">
          {shown}/{target} XP
        </span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--line)]"
        role="progressbar"
        aria-valuenow={shown}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-label={met ? "Daily goal met" : `Daily goal, ${shown} of ${target} XP`}
      >
        <div
          className="h-full rounded-full bg-[color-mix(in_srgb,var(--accent)_78%,var(--ink))] transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      {met ? <p className="mt-1 text-xs text-[var(--ink-muted)]">Daily goal met</p> : null}
    </div>
  );
}

type Props = {
  xp: number;
  streak: number;
  pending?: boolean;
  goal: DailyGoalStatus;
  summaries: PathSummary[];
  action: NextAction;
  onOpen: (action: NextAction) => void;
};

export function ProgressDashboard({ xp, streak, pending = false, goal, summaries, action, onOpen }: Props) {
  const figures = statsFigures(pending ? null : { xp, streak });
  const reviewsDue = summaries.reduce((sum, path) => sum + path.reviewsDue, 0);
  return (
    <section aria-label="Progress" className="mx-auto w-full max-w-[640px] px-4 pt-4 sm:px-10 sm:pt-8">
      <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Progress</h2>
      <SourceNote place="progress" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">XP</p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums text-[var(--ink)]" aria-busy={figures.busy}>
            {figures.xp}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">Streak</p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums text-[var(--ink)]" aria-busy={figures.busy}>
            {figures.busy ? figures.streak : `${figures.streak} ${streak === 1 ? "day" : "days"}`}
          </p>
        </div>
      </div>
      <div className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-3 py-3">
        <DailyGoalBar {...goal} />
      </div>
      <button
        type="button"
        onClick={() => onOpen(action)}
        className="mt-3 flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-4 py-3 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">Next</span>
        <span className="text-sm font-medium text-[var(--ink)]">{action.label}</span>
        {action.kind !== "none" ? <span className="text-xs text-[var(--ink-muted)]">{action.pathTitle}</span> : null}
      </button>
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Paths</h3>
          <p className="text-xs tabular-nums text-[var(--ink-muted)]">
            {reviewsDue} {reviewsDue === 1 ? "review" : "reviews"} due
          </p>
        </div>
        {summaries.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">Mastery for each path shows up here.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {summaries.map((path) => (
              <li key={path.projectId} className="rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-3 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">{path.title}</span>
                  <span className="shrink-0 text-sm tabular-nums text-[var(--ink)]">{path.percent}%</span>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"
                  role="progressbar"
                  aria-valuenow={path.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${path.title} mastery`}
                >
                  <div
                    className="h-full rounded-full bg-[color-mix(in_srgb,#6b9f7a_70%,var(--ink))]"
                    style={{ width: `${path.percent}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
                  {path.reviewsDue} {path.reviewsDue === 1 ? "review" : "reviews"} due
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

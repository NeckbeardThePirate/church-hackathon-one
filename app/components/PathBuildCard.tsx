"use client";

import type { PathMilestone, MilestoneState } from "../lib/learn/path-milestones";
import { StudyLamp } from "./StudyLamp";

type Props = {
  milestones: PathMilestone[];
  lessonOneReady: boolean;
  lessonOrder?: number;
  onStartLesson?: () => void;
};

function Mark({ state }: { state: MilestoneState }) {
  if (state === "done") {
    return (
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,#6b9f7a_55%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_18%,var(--sidebar))] text-[11px] text-[color-mix(in_srgb,#6b9f7a_85%,var(--ink))]">
        ✓
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative mt-0.5 inline-flex size-5 shrink-0 items-center justify-center">
        <span className="study-breathe absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_35%,transparent)]" />
        <span className="relative size-2 rounded-full bg-[var(--accent)]" />
      </span>
    );
  }
  return <span className="mt-0.5 inline-flex size-5 shrink-0 rounded-full border border-[var(--line)]" />;
}

/** Milestone strip for a path that is still being written. */
export function PathBuildCard({ milestones, lessonOneReady, lessonOrder = 1, onStartLesson }: Props) {
  const active = milestones.find((step) => step.state === "active");
  const headline = lessonOneReady ? `Lesson ${lessonOrder} is ready` : "The lamp is lit";
  const detail = lessonOneReady
    ? "Start now. The other lessons keep being written in the background."
    : (active?.detail ?? "Line upon line.");

  return (
    <section
      aria-label="Path building"
      className={`overflow-hidden rounded-2xl border bg-[var(--sidebar)] ${
        lessonOneReady
          ? "study-ready border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]"
          : "border-[var(--line)]"
      }`}
    >
      <div key={headline} className="study-rise flex items-start gap-3 px-4 py-4">
        <StudyLamp size={52} live />
        <div className="min-w-0 flex-1">
          <p className="study-serif break-words text-xl italic leading-snug text-[var(--ink)]">{headline}</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--ink-muted)]">{detail}</p>
          {lessonOneReady && onStartLesson ? (
            <button
              type="button"
              onClick={onStartLesson}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[#1c1a16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:w-auto"
            >
              Start Lesson {lessonOrder}
            </button>
          ) : null}
        </div>
      </div>
      <ol className="border-t border-[var(--line)] px-2 py-1">
        {milestones.map((step, index) => (
          <li
            key={step.id}
            className="study-rise flex min-w-0 gap-3 px-2 py-2.5"
            style={{ animationDelay: `${index * 70}ms` }}
            aria-current={step.state === "active" ? "step" : undefined}
          >
            <Mark state={step.state} />
            <div className="min-w-0 flex-1">
              <p className={`text-sm leading-snug ${step.state === "waiting" ? "text-[var(--ink-muted)]" : "text-[var(--ink)]"}`}>
                {step.label}
              </p>
              {step.state !== "waiting" && step.detail !== detail ? (
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-muted)]">{step.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

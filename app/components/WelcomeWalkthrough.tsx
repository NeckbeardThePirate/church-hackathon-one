"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DAILY_GOAL_XP } from "../lib/learn/learner-stats";
import type { StarterPathId } from "../lib/learn/starters";
import type { LearnPlan } from "../lib/learn/types";
import { LearnIntakeStep } from "./LearnIntakeStep";
import { StarterPathCard } from "./StarterPathCard";
import { StudyLamp } from "./StudyLamp";

const POINTS = [
  {
    title: "Lessons",
    body: "Open a lesson, read it, then take the check at the end. A miss can add a short practice lesson.",
  },
  {
    title: "Daily goal",
    body: `Reading and quizzes earn XP. ${DAILY_GOAL_XP} XP meets today’s goal and keeps your streak.`,
  },
  {
    title: "Progress",
    body: "XP, your streak, and what to do next stay in the menu. Every path’s mastery is on Progress.",
  },
] as const;

type HomeProps = {
  showIntro: boolean;
  framed?: boolean;
  projectId: string;
  starterBusy: StarterPathId | null;
  starterError: string | null;
  onChooseStarter: (id: StarterPathId) => void;
  onStarted: (planId: string, topic: string) => void;
  onComplete: (plan: LearnPlan) => void;
  onStudyReady?: (plan: LearnPlan) => void;
  onHideIntro: () => void;
  onReplayIntro?: () => void;
};

const skipClass =
  "inline-flex min-h-11 shrink-0 items-center px-2 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

const textActionClass =
  "inline-flex min-h-11 items-center text-left text-sm font-medium text-[var(--ink)] underline decoration-[color-mix(in_srgb,var(--accent)_40%,transparent)] underline-offset-[3px] hover:decoration-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

export function WelcomePending() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center">
      <StudyLamp size={52} live={false} />
      <p className="mt-4 text-sm text-[var(--ink-muted)]">Setting the desk…</p>
    </div>
  );
}

/** The only thing on an empty desk: what Study Buddy does, then a real first path. */
export function FirstRunHome({
  showIntro,
  framed = false,
  projectId,
  starterBusy,
  starterError,
  onChooseStarter,
  onStarted,
  onComplete,
  onStudyReady,
  onHideIntro,
  onReplayIntro,
}: HomeProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const introWas = useRef(showIntro);

  useEffect(() => {
    if (showIntro && !introWas.current) setOwnOpen(false);
    introWas.current = showIntro;
  }, [showIntro]);

  useEffect(() => {
    if (!showIntro) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onHideIntro();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showIntro, onHideIntro]);

  return (
    <div
      data-first-run=""
      className={
        framed
          ? "px-5 py-5 sm:px-6 sm:py-6"
          : "mx-auto flex min-h-full w-full max-w-[28rem] flex-col justify-center px-5 py-10 sm:px-6 sm:py-16"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <StudyLamp size={52} live={false} />
        {showIntro ? (
          <button type="button" onClick={onHideIntro} className={skipClass}>
            Skip
          </button>
        ) : (
          <span className="size-11 shrink-0" aria-hidden />
        )}
      </div>
      <p className="mt-5 text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        {showIntro ? "Welcome" : "New path"}
      </p>
      <h1
        id="welcome-title"
        className="study-serif mt-2 break-words text-[1.85rem] font-medium italic leading-[1.15] tracking-[-0.02em] text-[var(--ink)] sm:text-[2.35rem]"
      >
        {showIntro ? "Study one thing at a time" : "Start a path"}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
        {showIntro
          ? "Bring a goal, a Scripture passage, or a photo of your notes. StudyBuddy turns it into a lesson plan you can read, check, and pick up again tomorrow."
          : "Pick a short Scripture path, or bring your own passage, notes, or photo."}
      </p>
      <div className="mt-6">
        <StarterPathCard busyId={starterBusy} error={starterError} onChoose={onChooseStarter} />
      </div>
      <button
        type="button"
        aria-expanded={ownOpen}
        onClick={() => setOwnOpen((open) => !open)}
        className={`mt-3 ${textActionClass}`}
      >
        {ownOpen ? "Hide my own material" : "Use my own passage, notes, or photo"}
      </button>
      {ownOpen ? (
        <div className="mt-3 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_88%,var(--canvas))] px-3 py-4 sm:px-4">
          <LearnIntakeStep
            embedded
            projectId={projectId}
            onStarted={onStarted}
            onComplete={onComplete}
            onStudyReady={onStudyReady}
          />
        </div>
      ) : null}
      {!showIntro && onReplayIntro ? (
        <button type="button" onClick={onReplayIntro} className={`mt-6 self-start ${skipClass} px-0`}>
          Replay the welcome
        </button>
      ) : null}
    </div>
  );
}

/** Short note once a real path exists. It sits on the path, then gets out of the way. */
export function WelcomeOrientation({ building, onClose }: { building: boolean; onClose: () => void }) {
  return (
    <section aria-label="How your path works" className="mx-auto w-full max-w-[40rem] px-4 pt-4 sm:px-8 sm:pt-8">
      <div className="study-rise rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[var(--sidebar)] px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            {building ? "Path started" : "Path ready"}
          </p>
          <button type="button" onClick={onClose} className={skipClass}>
            Skip
          </button>
        </div>
        <h2 className="study-serif mt-1 break-words text-2xl font-medium italic leading-snug text-[var(--ink)]">
          {building ? "Your lesson plan is on the way" : "Your first lesson plan is open"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
          {building
            ? "You can leave this page. The first lesson opens as soon as it is written."
            : "This path is saved in your workspace."}
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {POINTS.map((point) => (
            <li key={point.title} className="min-w-0">
              <p className="text-sm font-medium text-[var(--ink)]">{point.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-[var(--ink-muted)]">{point.body}</p>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[#1c1a16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:w-auto"
        >
          {building ? "Watch it build" : "Start this path"}
        </button>
      </div>
    </section>
  );
}

export function WelcomeReplayDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="safe-area-x fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Close welcome" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        tabIndex={-1}
        className="relative max-h-[min(100dvh-2rem,44rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--sidebar)] outline-none [scrollbar-gutter:stable]"
      >
        {children}
      </div>
    </div>
  );
}

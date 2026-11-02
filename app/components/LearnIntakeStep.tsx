"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TRADITIONS,
  isPerspective,
  type LearnPlan,
  type LearnStage,
  type Perspective,
  type Heartbeat,
  type PlanSnapshot,
  type ProgressEvent,
} from "../lib/learn/types";

import { StillWorking } from "./StillWorking";
import { fetchLearnPerspective, saveLearnPerspective } from "../lib/workspace-sync";

type Props = {
  learnPlanId?: string;
  onStarted: (planId: string) => void;
  onComplete: (plan: LearnPlan) => void;
  onSkip: () => void;
};

const STEPS: { stage: LearnStage[]; label: string }[] = [
  { stage: ["intake", "scope"], label: "Scope" },
  { stage: ["plan"], label: "Outline" },
  { stage: ["teach", "check", "research", "verify", "review"], label: "Lessons" },
  { stage: ["critic"], label: "Review" },
  { stage: ["assemble", "done"], label: "Assemble" },
];

function stepIndex(stage: LearnStage | undefined): number {
  if (!stage) return 0;
  const i = STEPS.findIndex((s) => s.stage.includes(stage));
  return i === -1 ? 0 : i;
}

async function loadDefaultPerspective(): Promise<Perspective> {
  try {
    const saved = await fetchLearnPerspective();
    return isPerspective(saved) ? saved : "neutral";
  } catch {
    return "neutral";
  }
}

export function LearnIntakeStep({ learnPlanId, onStarted, onComplete, onSkip }: Props) {
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [perspective, setPerspective] = useState<Perspective>("neutral");
  const [makeDefault, setMakeDefault] = useState(false);
  const [includeScripture, setIncludeScripture] = useState<"auto" | "yes" | "no">("auto");
  const [planId, setPlanId] = useState<string | undefined>(learnPlanId);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const feedRef = useRef<HTMLOListElement>(null);
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [heartbeatReceivedAt, setHeartbeatReceivedAt] = useState<number | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    void loadDefaultPerspective().then(setPerspective);
  }, []);

  const refresh = useCallback(async (id: string) => {
    const res = await fetch(`/api/learn/plans/${id}`, { credentials: "same-origin" });
    if (!res.ok) return null;
    const snap = (await res.json()) as PlanSnapshot;
    setSnapshot(snap);
    return snap;
  }, []);

  const finish = useCallback(
    (snap: PlanSnapshot) => {
      setSnapshot(snap);
      if (snap.plan && !completedRef.current) {
        completedRef.current = true;
        onComplete(snap.plan);
      } else if (snap.status === "failed") {
        setError(snap.error ?? "The plan could not be built.");
      }
    },
    [onComplete],
  );

  // Live progress over SSE. EventSource resumes with Last-Event-ID on reconnect.
  useEffect(() => {
    if (!planId) return;
    completedRef.current = false;
    let closed = false;
    const source = new EventSource(`/api/learn/plans/${planId}/events`);

    source.addEventListener("progress", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as ProgressEvent;
      setEvents((prev) => (prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev]));
      if (ev.stage === "plan" || ev.stage === "check" || ev.stage === "critic") void refresh(planId);
    });
    source.addEventListener("heartbeat", (e) => {
      setHeartbeat(JSON.parse((e as MessageEvent).data) as Heartbeat);
      setHeartbeatReceivedAt(Date.now());
    });
    source.addEventListener("done", (e) => {
      closed = true;
      source.close();
      finish(JSON.parse((e as MessageEvent).data) as PlanSnapshot);
    });
    source.onerror = () => {
      if (closed) return;
      // Browser retries automatically; check whether the plan is gone or finished.
      void refresh(planId).then((snap) => {
        if (!snap) {
          source.close();
          setError("Lost connection to the plan. Reload to try again.");
        } else if (snap.status === "complete" || snap.status === "partial" || snap.status === "failed") {
          source.close();
          finish(snap);
        }
      });
    };
    void refresh(planId);
    return () => {
      closed = true;
      source.close();
    };
  }, [planId, refresh, finish]);

  useEffect(() => {
    feedRef.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [events.length]);

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      if (makeDefault) await saveLearnPerspective(perspective);
      const res = await fetch("/api/learn/plans", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic, notes, options: { perspective, includeScripture } }),
      });
      const body = (await res.json().catch(() => ({}))) as { planId?: string; error?: string };
      if (!res.ok || !body.planId) throw new Error(body.error ?? `Could not start (${res.status}).`);
      setEvents([]);
      setSnapshot(null);
      setPlanId(body.planId);
      onStarted(body.planId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start the plan.");
    } finally {
      setStarting(false);
    }
  }, [topic, notes, perspective, includeScripture, makeDefault, onStarted]);

  const currentStage = events.at(-1)?.stage ?? snapshot?.stage;
  const active = stepIndex(currentStage);
  const lessonsTotal = snapshot?.lessonsTotal ?? 0;
  const lessonsDone = snapshot?.lessonsDone ?? 0;
  const failed = snapshot?.status === "failed" || !!error;

  const feed = useMemo(() => events.filter((e) => e.message), [events]);

  if (!planId) {
    return (
      <section className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-14 sm:px-10 sm:pt-16">
        <header className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Learn · New plan</p>
          <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[var(--ink)]">What do you want to learn?</h1>
          <p className="max-w-md text-base leading-relaxed text-[var(--ink-muted)]">
            We build a step-by-step plan with lessons, readings, and quizzes. You can watch it come together.
          </p>
        </header>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-[var(--ink)]">Topic</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={500}
            placeholder="e.g. The book of Romans, compound interest, intro to Greek"
            className="rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-[var(--ink)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-[var(--ink)]">
            Notes <span className="font-normal text-[var(--ink-muted)]">(optional: goals, what you already know)</span>
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={20000}
            className="rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-sm text-[var(--ink)] outline-none [scrollbar-gutter:stable] focus:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-[var(--ink)]">Perspective on faith topics</legend>
          <select
            value={perspective}
            onChange={(e) => setPerspective(isPerspective(e.target.value) ? e.target.value : "neutral")}
            className="rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-sm text-[var(--ink)]"
          >
            <option value="neutral">Neutral: present each tradition's view, take no side</option>
            {TRADITIONS.map((t) => (
              <option key={t} value={t}>
                {t}: teach from this tradition, other views labeled
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
            Use this as my default for new plans
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-[var(--ink)]">Scripture readings</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["auto", "When relevant"],
                ["yes", "Always"],
                ["no", "Never"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setIncludeScripture(value)}
                className={`min-h-11 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  includeScripture === value
                    ? "border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] bg-[var(--sidebar-active)] text-[var(--ink)]"
                    : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {error ? <p className="text-sm text-[#c0533f]">{error}</p> : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={starting || topic.trim().length < 3}
            onClick={start}
            className="min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-base font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Starting…" : "Build my plan"}
          </button>
          <button type="button" onClick={onSkip} className="min-h-11 text-base text-[var(--ink-muted)] hover:text-[var(--ink)]">
            Skip and write notes instead
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-14 sm:px-10 sm:pt-16">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Learn · Building plan</p>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)]">
          {failed ? "The plan stopped" : "Putting your plan together"}
        </h1>
      </header>

      {!failed && snapshot?.status !== "complete" && snapshot?.status !== "partial" ? (
        <StillWorking
          stage={currentStage}
          heartbeat={heartbeat}
          heartbeatReceivedAt={heartbeatReceivedAt}
          startedAt={events[0]?.at ?? heartbeatReceivedAt ?? Date.now()}
        />
      ) : null}

      <ol className="flex gap-1.5" aria-label="Pipeline progress">
        {STEPS.map((step, i) => {
          const state = failed && i === active ? "failed" : i < active ? "done" : i === active ? "active" : "todo";
          return (
            <li key={step.label} className="flex flex-1 flex-col gap-1.5">
              <span
                className={`h-1.5 rounded-full ${
                  state === "done"
                    ? "bg-[var(--accent)]"
                    : state === "active"
                      ? "animate-pulse bg-[color-mix(in_srgb,var(--accent)_60%,transparent)]"
                      : state === "failed"
                        ? "bg-[#c0533f]"
                        : "bg-[var(--line)]"
                }`}
              />
              <span className={`text-xs ${state === "todo" ? "text-[var(--ink-muted)]" : "text-[var(--ink)]"}`}>
                {step.label}
                {step.label === "Lessons" && lessonsTotal ? ` ${lessonsDone}/${lessonsTotal}` : ""}
              </span>
            </li>
          );
        })}
      </ol>

      <ol
        ref={feedRef}
        className="flex max-h-[420px] flex-col gap-1 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--sidebar)] p-4 font-mono text-xs leading-relaxed [scrollbar-gutter:stable]"
        aria-live="polite"
      >
        {feed.length === 0 ? <li className="text-[var(--ink-muted)]">Waiting for the first stage…</li> : null}
        {feed.map((ev) => (
          <li key={ev.seq} className="flex gap-3">
            <span className="w-16 shrink-0 text-[var(--ink-muted)]">{ev.stage}</span>
            <span className={ev.stage === "error" ? "text-[#c0533f]" : "text-[var(--ink)]"}>{ev.message}</span>
          </li>
        ))}
      </ol>

      {failed ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[#c0533f]">{error ?? snapshot?.error}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setPlanId(undefined);
                setError(null);
                setEvents([]);
              }}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink)]"
            >
              Start over
            </button>
            <button type="button" onClick={onSkip} className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]">
              Write notes instead
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">You can leave this page. Progress resumes when you come back.</p>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LearnPlan,
  type LearnStage,
  type Heartbeat,
  type PlanSnapshot,
  type ProgressEvent,
} from "../lib/learn/types";

import { StillWorking } from "./StillWorking";
import { saveLearnPerspective } from "../lib/workspace-sync";
import { LearnStartForm, type StartPayload } from "./LearnStartForm";

type Props = {
  projectId: string;
  learnPlanId?: string;
  onStarted: (planId: string) => void;
  onComplete: (plan: LearnPlan) => void;
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

export function LearnIntakeStep({ projectId, learnPlanId, onStarted, onComplete }: Props) {
  const [planId, setPlanId] = useState<string | undefined>(learnPlanId);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const feedRef = useRef<HTMLOListElement>(null);
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [heartbeatReceivedAt, setHeartbeatReceivedAt] = useState<number | null>(null);
  const completedRef = useRef(false);

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
        setError(snap.error ?? "The path could not be built.");
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
          setError("Lost connection to the path. Reload to try again.");
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

  const start = useCallback(
    async ({ topic, notes, perspective, includeScripture, makeDefault }: StartPayload) => {
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
        setError(failure instanceof Error ? failure.message : "Could not start the path.");
      } finally {
        setStarting(false);
      }
    },
    [onStarted],
  );

  const currentStage = events.at(-1)?.stage ?? snapshot?.stage;
  const active = stepIndex(currentStage);
  const lessonsTotal = snapshot?.lessonsTotal ?? 0;
  const lessonsDone = snapshot?.lessonsDone ?? 0;
  const failed = snapshot?.status === "failed" || !!error;

  const feed = useMemo(() => events.filter((e) => e.message), [events]);

  if (!planId) {
    return <LearnStartForm projectId={projectId} starting={starting} error={error} onStart={(payload) => void start(payload)} />;
  }

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-14 sm:px-10 sm:pt-16">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Learn path · Building</p>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)]">
          {failed ? "The path stopped" : "Building your path"}
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
              className="rounded-lg border border-[var(--line)] min-h-11 px-4 py-2 text-sm text-[var(--ink)]"
            >
              Start over
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">You can leave this page. Progress resumes when you come back.</p>
      )}
    </section>
  );
}

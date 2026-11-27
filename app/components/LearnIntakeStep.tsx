"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LearnPlan,
  type Heartbeat,
  type PlanSnapshot,
  type ProgressEvent,
} from "../lib/learn/types";

import { lessonIsStudyable, pathMilestones } from "../lib/learn/path-milestones";
import { PathBuildCard } from "./PathBuildCard";
import { StillWorking } from "./StillWorking";
import { saveLearnPerspective } from "../lib/workspace-sync";
import { LearnStartForm, type StartPayload } from "./LearnStartForm";

type Props = {
  projectId: string;
  learnPlanId?: string;
  onStarted: (planId: string, topic: string) => void;
  onComplete: (plan: LearnPlan) => void;
  /** First core lesson ready while the pipeline is still running. */
  onStudyReady?: (plan: LearnPlan) => void;
  onMarkFailed?: () => void;
  onRequestRemove?: () => void;
  /** First-run page: the form sits under the welcome, without a second title. */
  embedded?: boolean;
};

function planReadyToStudy(snap: PlanSnapshot): snap is PlanSnapshot & { plan: LearnPlan } {
  if (!snap.plan) return false;
  return snap.plan.lessons.some(lessonIsStudyable);
}

export function LearnIntakeStep({
  projectId,
  learnPlanId,
  onStarted,
  onComplete,
  onStudyReady,
  onMarkFailed,
  onRequestRemove,
  embedded = false,
}: Props) {
  const [planId, setPlanId] = useState<string | undefined>(learnPlanId);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const feedRef = useRef<HTMLOListElement>(null);
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [heartbeatReceivedAt, setHeartbeatReceivedAt] = useState<number | null>(null);
  const completedRef = useRef(false);
  const studyReadyRef = useRef(false);

  const refresh = useCallback(async (id: string) => {
    const res = await fetch(`/api/learn/plans/${id}?view=plan`, { credentials: "same-origin" });
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
    studyReadyRef.current = false;
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

  const start = useCallback(
    async ({ topic, notes, passages, photos, perspective, includeScripture, makeDefault }: StartPayload) => {
      setError(null);
      setStarting(true);
      try {
        if (makeDefault) await saveLearnPerspective(perspective);
        const res = await fetch("/api/learn/plans", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic, notes, passages, photos, options: { perspective, includeScripture } }),
        });
        const body = (await res.json().catch(() => ({}))) as { planId?: string; topic?: string; error?: string };
        if (!res.ok || !body.planId) throw new Error(body.error ?? `Could not start (${res.status}).`);
        setEvents([]);
        setSnapshot(null);
        setPlanId(body.planId);
        onStarted(body.planId, body.topic ?? topic);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not start the path.");
      } finally {
        setStarting(false);
      }
    },
    [onStarted],
  );

  useEffect(() => {
    if (snapshot?.status === "failed") onMarkFailed?.();
  }, [snapshot?.status, onMarkFailed]);

  useEffect(() => {
    if (!snapshot || studyReadyRef.current || !onStudyReady) return;
    if (snapshot.status !== "running" && snapshot.status !== "partial") return;
    if (!planReadyToStudy(snapshot)) return;
    studyReadyRef.current = true;
    onStudyReady(snapshot.plan);
  }, [snapshot, onStudyReady]);

  const currentStage = events.at(-1)?.stage ?? snapshot?.stage;
  const lessonsTotal = snapshot?.lessonsTotal ?? 0;
  const lessonsDone = snapshot?.lessonsDone ?? 0;
  const lessonOneReady = snapshot?.plan?.lessons.some(lessonIsStudyable) ?? false;
  const milestones = useMemo(
    () =>
      pathMilestones({
        stage: currentStage,
        status: snapshot?.status,
        lessonsDone,
        lessonsTotal,
        lessonOneReady,
      }),
    [currentStage, snapshot?.status, lessonsDone, lessonsTotal, lessonOneReady],
  );
  const failed = snapshot?.status === "failed" || !!error;

  useEffect(() => {
    feedRef.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [events.length, failed]);

  const feed = useMemo(() => events.filter((e) => e.message), [events]);

  if (!planId) {
    return (
      <LearnStartForm
        embedded={embedded}
        projectId={projectId}
        starting={starting}
        error={error}
        onStart={(payload) => void start(payload)}
      />
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-5 overflow-x-clip px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-5 sm:px-10 sm:pt-16">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">Learn path · Building</p>
        <h1 className="break-words text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)]">
          {failed ? "The path stopped" : "Building your path"}
        </h1>
      </header>

      {!failed && snapshot?.status !== "complete" && snapshot?.status !== "partial" ? (
        <div
          className={`overflow-hidden rounded-2xl border bg-[var(--sidebar)] ${
            lessonOneReady
              ? "study-ready border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]"
              : "border-[var(--line)]"
          }`}
        >
          <PathBuildCard embedded milestones={milestones} lessonOneReady={lessonOneReady} />
          <StillWorking
            hideLamp
            stage={currentStage}
            heartbeat={heartbeat}
            heartbeatReceivedAt={heartbeatReceivedAt}
            startedAt={events[0]?.at ?? heartbeatReceivedAt ?? Date.now()}
          />
        </div>
      ) : null}

      {failed ? (
        <details
          className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--sidebar)]"
          open={notesOpen}
          onToggle={(event) => setNotesOpen(event.currentTarget.open)}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm text-[var(--ink-muted)] [&::-webkit-details-marker]:hidden">
            Stage notes
          </summary>
          <ol
            ref={feedRef}
            className="flex max-h-48 flex-col gap-1 overflow-x-clip overflow-y-auto border-t border-[var(--line)] p-4 font-mono text-xs leading-relaxed [scrollbar-gutter:stable] sm:max-h-[420px]"
            aria-live="polite"
          >
            {feed.length === 0 ? <li className="text-[var(--ink-muted)]">Waiting for the first stage…</li> : null}
            {feed.map((ev) => (
              <li key={ev.seq} className="flex min-w-0 gap-3">
                <span className="w-16 shrink-0 text-[var(--ink-muted)]">{ev.stage}</span>
                <span className={`min-w-0 break-words ${ev.stage === "error" ? "text-[#c0533f]" : "text-[var(--ink)]"}`}>{ev.message}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {failed ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[#c0533f]">{error ?? snapshot?.error}</p>
          <div className="flex flex-wrap gap-3">
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
            {onRequestRemove ? (
              <button
                type="button"
                onClick={onRequestRemove}
                className="min-h-11 rounded-lg border border-[color-mix(in_srgb,#c0533f_45%,var(--line))] px-4 py-2 text-sm text-[var(--ink)]"
              >
                Remove path
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--ink-muted)]">You can leave this page. Progress resumes when you come back.</p>
          {onRequestRemove ? (
            <button
              type="button"
              onClick={onRequestRemove}
              className="min-h-11 rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              Remove path
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openerStep, type OpenerPublic, type OpenerPublicQuestion } from "../lib/learn/opener";
import { StudyShimmer } from "./StudyLamp";

type Props = {
  planId: string;
  onSettled: (summary: string) => void;
};

const CHOICE =
  "min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-3 py-2.5 text-left text-sm leading-snug text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60";

/** Longer than the server wait so a slow adaptive answer is recorded before this fetch is aborted. */
const ASK_MS = 60_000;

/**
 * Short check shown while the path is already being built.
 * Skip is always available. A failed model call stays on screen with a retry.
 */
export function OpenerQuiz({ planId, onSettled }: Props) {
  const [view, setView] = useState<OpenerPublic | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hidden, setHidden] = useState(false);
  const settled = useRef(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const settle = (summary: string) => {
    if (settled.current) return;
    settled.current = true;
    onSettledRef.current(summary);
  };

  useLayoutEffect(() => {
    if (!isOpenerDismissed(planId)) return;
    setHidden(true);
    settle("");
  }, [planId]);

  useEffect(() => {
    if (isOpenerDismissed(planId)) return;
    let live = true;
    settled.current = false;
    const signal = { live: () => live && !settled.current };

    void (async () => {
      const current = await readOpener(planId).catch(() => null);
      if (!signal.live()) return;
      const seen = takeStep(current);
      if (seen?.kind === "show") {
        setView(seen.body);
        setFailed(false);
        return;
      }
      if (seen?.kind === "done") {
        dismissOpener(planId);
        setHidden(true);
        settle(seen.body.summary ?? "");
        return;
      }
      const result = await askOnce(planId, signal);
      if (!signal.live() || !result) return;
      if (result.kind === "show") {
        setView(result.body);
        setFailed(false);
      } else if (result.kind === "done") {
        dismissOpener(planId);
        setHidden(true);
        settle(result.body.summary ?? "");
      } else setFailed(true);
    })();
    return () => {
      live = false;
    };
  }, [planId, attempt]);

  const skip = () => {
    dismissOpener(planId);
    setHidden(true);
    settle("");
    void postOpener(planId, { action: "skip" }, 12_000).then((body) => {
      if (body.summary) onSettledRef.current(body.summary);
    }).catch(() => {});
  };

  const retry = () => {
    if (busy || settled.current) return;
    setFailed(false);
    setView(null);
    setAttempt((value) => value + 1);
  };

  const choose = async (question: OpenerPublicQuestion, choiceId: string) => {
    if (busy || settled.current) return;
    setBusy(true);
    setFailed(false);
    try {
      const next = await postOpener(planId, { action: "answer", questionId: question.id, choiceId }, ASK_MS);
      if (settled.current) return;
      const stepped = openerStep(next);
      if (stepped === "show") {
        setView(next);
        setBusy(false);
        return;
      }
      if (stepped === "done") {
        dismissOpener(planId);
        setHidden(true);
        settle(next.summary ?? "");
        return;
      }
      const followed = await askOnce(planId, { live: () => !settled.current });
      if (settled.current || !followed) return;
      if (followed.kind === "show") {
        setView(followed.body);
        setBusy(false);
      } else if (followed.kind === "done") {
        dismissOpener(planId);
        setHidden(true);
        settle(followed.body.summary ?? "");
      } else {
        setBusy(false);
        setFailed(true);
      }
    } catch {
      if (!settled.current) {
        setBusy(false);
        setFailed(true);
      }
    }
  };

  if (hidden) return null;

  const question = view?.status === "asking" ? view.question : undefined;
  const index = view?.index ?? 1;
  const limit = view?.limit ?? 4;

  return (
    <div className="px-4 pb-2 pt-5 sm:px-6 sm:pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        {question ? `A short check · ${index} of ${limit}` : "A short check"}
      </p>
      {question ? (
        <>
          <div className="mt-3 flex gap-1.5" aria-hidden>
            {Array.from({ length: limit }, (_, step) => (
              <span
                key={step}
                className={`h-1 flex-1 rounded-full ${
                  step < index - 1
                    ? "bg-[var(--accent)]"
                    : step === index - 1
                      ? "bg-[linear-gradient(90deg,var(--accent),#e7c56a)]"
                      : "bg-[color-mix(in_srgb,var(--accent)_22%,var(--line))]"
                }`}
              />
            ))}
          </div>
          <h2 className="study-serif mt-4 text-xl italic leading-snug text-[var(--ink)]">{question.prompt}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--ink-muted)]">Your path is already being written. These answers steer it.</p>
          <div className="mt-4 flex max-h-[40vh] flex-col gap-2 overflow-y-auto [scrollbar-gutter:stable]" role="group" aria-label="Answer">
            {question.choices.map((choice) => (
              <button key={choice.id} type="button" className={CHOICE} disabled={busy} onClick={() => void choose(question, choice.id)}>
                {choice.label}
              </button>
            ))}
          </div>
        </>
      ) : failed ? (
        <div className="mt-3" role="alert">
          <p className="study-serif text-xl italic leading-snug text-[var(--ink)]">The check didn’t load.</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--ink-muted)]">Your path is still being written. Try the question again, or skip.</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--canvas)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="mt-3" role="status" aria-live="polite">
          <p className="study-serif text-xl italic leading-snug text-[var(--ink)]">One question at a time, while your path is written.</p>
          <StudyShimmer className="mt-4 h-3 w-4/5" />
        </div>
      )}
      <button
        type="button"
        onClick={skip}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--line)] px-4 text-sm font-medium text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:w-auto"
      >
        Skip to my path
      </button>
    </div>
  );
}

function dismissKey(planId: string): string {
  return `opener-dismissed:${planId}`;
}

function isOpenerDismissed(planId: string): boolean {
  try {
    return sessionStorage.getItem(dismissKey(planId)) === "1";
  } catch {
    return false;
  }
}

function dismissOpener(planId: string): void {
  try {
    sessionStorage.setItem(dismissKey(planId), "1");
  } catch {
    // This view still unmounts. A later mount may show the card once.
  }
}

async function readOpener(planId: string): Promise<OpenerPublic> {
  const response = await fetch(`/api/learn/plans/${planId}/opener`, { credentials: "same-origin", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`opener ${response.status}`);
  return (await response.json()) as OpenerPublic;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Pursuit = { kind: "show" | "done"; body: OpenerPublic } | { kind: "fail"; body: OpenerPublic | null };

/** One attempt. A miss becomes an error the learner can retry, not another silent wait. */
async function askOnce(planId: string, signal: { live: () => boolean }): Promise<Pursuit | null> {
  const next = await postOpener(planId, { action: "next" }, ASK_MS).catch(() => null);
  if (!signal.live()) return null;
  const stepped = takeStep(next);
  if (stepped) return stepped;
  if (next?.status === "ready" && next.pending) {
    const polled = await pollOpener(planId, signal, 8_000);
    if (!signal.live()) return null;
    const found = takeStep(polled);
    if (found) return found;
  }
  return { kind: "fail", body: next };
}

function takeStep(body: OpenerPublic | null): Pursuit | null {
  const step = openerStep(body);
  if (!body || step === "wait") return null;
  return { kind: step, body };
}

async function pollOpener(planId: string, signal: { live: () => boolean }, ms: number): Promise<OpenerPublic | null> {
  const deadline = Date.now() + ms;
  while (signal.live() && Date.now() < deadline) {
    await wait(800);
    const current = await readOpener(planId).catch(() => null);
    if (takeStep(current)) return current;
  }
  return null;
}

async function postOpener(
  planId: string,
  payload: { action: "next" | "skip" } | { action: "answer"; questionId: string; choiceId: string },
  timeoutMs: number,
): Promise<OpenerPublic> {
  const response = await fetch(`/api/learn/plans/${planId}/opener`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`opener ${response.status}`);
  return (await response.json()) as OpenerPublic;
}

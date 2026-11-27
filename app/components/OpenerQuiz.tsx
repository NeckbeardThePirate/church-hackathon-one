"use client";

import { useEffect, useRef, useState } from "react";
import { openerStep, type OpenerPublic, type OpenerPublicQuestion } from "../lib/learn/opener";
import { StudyShimmer } from "./StudyLamp";

type Props = {
  planId: string;
  onSettled: (summary: string) => void;
};

const CHOICE =
  "min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-3 py-2.5 text-left text-sm leading-snug text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60";

/**
 * Short check shown while the path is already being built.
 * Skip is always available. A failed or slow model call settles the check and leaves the path alone.
 */
export function OpenerQuiz({ planId, onSettled }: Props) {
  const [view, setView] = useState<OpenerPublic | null>(null);
  const [busy, setBusy] = useState(false);
  const settled = useRef(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const settle = (summary: string) => {
    if (settled.current) return;
    settled.current = true;
    onSettledRef.current(summary);
  };

  useEffect(() => {
    let live = true;
    settled.current = false;
    const signal = { live: () => live && !settled.current };

    void pursueOpener(planId, signal).then((result) => {
      if (!signal.live() || !result) return;
      if (result.kind === "show") setView(result.body);
      else settle(result.body.summary ?? "");
    });
    return () => {
      live = false;
    };
  }, [planId]);

  const skip = () => {
    settle("");
    void fetch(`/api/learn/plans/${planId}/opener`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "skip" }),
      signal: AbortSignal.timeout(12_000),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as OpenerPublic;
        if (body.summary) onSettledRef.current(body.summary);
      })
      .catch(() => {});
  };

  const choose = async (question: OpenerPublicQuestion, choiceId: string) => {
    if (busy || settled.current) return;
    setBusy(true);
    try {
      const next = await postOpener(planId, { action: "answer", questionId: question.id, choiceId });
      if (settled.current) return;
      const stepped = openerStep(next);
      if (stepped === "show") {
        setView(next);
        setBusy(false);
        return;
      }
      if (stepped === "done") {
        settle(next.summary ?? "");
        return;
      }
      setView(null);
      setBusy(false);
      const followed = await pursueOpener(planId, { live: () => !settled.current });
      if (settled.current || !followed) return;
      if (followed.kind === "show") setView(followed.body);
      else settle(followed.body.summary ?? "");
    } catch {
      if (!settled.current) setBusy(false);
    }
  };

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
          <div className="mt-4 flex flex-col gap-2 [scrollbar-gutter:stable]" role="group" aria-label="Answer">
            {question.choices.map((choice) => (
              <button key={choice.id} type="button" className={CHOICE} disabled={busy} onClick={() => void choose(question, choice.id)}>
                {choice.label}
              </button>
            ))}
          </div>
        </>
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

async function readOpener(planId: string): Promise<OpenerPublic> {
  const response = await fetch(`/api/learn/plans/${planId}/opener`, { credentials: "same-origin", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`opener ${response.status}`);
  return (await response.json()) as OpenerPublic;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Pursuit = { kind: "show" | "done"; body: OpenerPublic };

/**
 * Keep asking until a question is on screen, the learner is done, or this view goes away.
 * A close before any answer is a failed attempt, not a reason to hide the check.
 */
async function pursueOpener(planId: string, signal: { live: () => boolean }): Promise<Pursuit | null> {
  let posts = 0;
  while (signal.live()) {
    const current = await readOpener(planId).catch(() => null);
    if (!signal.live()) return null;
    const seen = takeStep(current);
    if (seen) return seen;
    if (posts >= 5) {
      await wait(3_000);
      continue;
    }
    posts += 1;
    const next = await postOpener(planId, { action: "next" }).catch(() => null);
    if (!signal.live()) return null;
    const stepped = takeStep(next);
    if (stepped) return stepped;
    if (next?.status === "ready" && next.pending) {
      const polled = await pollOpener(planId, signal, 26_000);
      if (!signal.live()) return null;
      const found = takeStep(polled);
      if (found) return found;
    }
    await wait(800);
  }
  return null;
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

async function postOpener(planId: string, payload: { action: "next" | "skip" } | { action: "answer"; questionId: string; choiceId: string }): Promise<OpenerPublic> {
  const response = await fetch(`/api/learn/plans/${planId}/opener`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(28_000),
  });
  if (!response.ok) throw new Error(`opener ${response.status}`);
  return (await response.json()) as OpenerPublic;
}

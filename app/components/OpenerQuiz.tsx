"use client";

import { useEffect, useRef, useState } from "react";
import type { OpenerPublic, OpenerPublicQuestion } from "../lib/learn/opener";
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
    const finish = (summary: string) => {
      if (!live) return;
      settle(summary);
    };

    const load = async () => {
      try {
        const current = await readOpener(planId).catch(() => null);
        if (!live) return;
        if (current?.status === "closed") {
          finish(current.summary ?? "");
          return;
        }
        if (current?.status === "asking" && current.question) {
          setView(current);
          return;
        }
        const next = await askNext(planId);
        if (!live) return;
        if (next.status === "closed" || !next.question) {
          finish(next.summary ?? "");
          return;
        }
        setView(next);
      } catch {
        finish("");
      }
    };

    void load();
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
      if (next.status === "asking" && next.question) {
        setView(next);
        setBusy(false);
        return;
      }
      settle(next.summary ?? "");
    } catch {
      settle("");
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

async function askNext(planId: string): Promise<OpenerPublic> {
  let started: OpenerPublic | null = null;
  try {
    started = await postOpener(planId, { action: "next" });
  } catch {
    started = null;
  }
  if (started && !(started.status === "ready" && started.pending)) return started;
  // Another request may still be writing the question. Poll instead of giving up.
  const deadline = Date.now() + 26_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const current = await readOpener(planId);
      if (current.status === "closed" || (current.status === "asking" && current.question)) return current;
    } catch {
      // The read can time out while the model call is still in flight.
    }
  }
  return { status: "closed", reason: "unavailable", index: 0, answered: 0, limit: 4, summary: "" };
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

"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { applyPlanMastery, type LearnAttemptAnswer } from "../lib/learn/attempts";
import type { GradeResult } from "../lib/learn/grade-answer";
import { XP_QUIZ_ATTEMPT, XP_QUIZ_CORRECT, XP_QUIZ_PARTIAL } from "../lib/learn/learner-stats";
import { newConceptMastery, type ConceptMastery, type LearnPlanProgress } from "../lib/learn/plan-progress";
import { postLearnAttempt } from "../lib/learn/post-attempt";
import { conceptProgressKey, withConceptMastery, type ProgressScope } from "../lib/learn/progress-scope";
import {
  conceptItemBank,
  keepFresherConceptMastery,
  pickReviewItem,
  reviewLessonId,
  reviewQuality,
  reviewQueue,
  scheduleConcept,
} from "../lib/learn/sm2";
import type { LearnPlan, QuizItem } from "../lib/learn/types";

type Props = {
  plan: LearnPlan;
  scope: ProgressScope;
  progress: LearnPlanProgress;
  timeZone: string;
  gradeShort: (item: QuizItem, given: string) => Promise<GradeResult>;
  onCommit: (updater: (prev: LearnPlanProgress) => LearnPlanProgress) => void;
  onAward?: (reason: string, amount: number) => void;
};

type GradeState = { correct: boolean; partial: boolean; skipped: boolean };

type ShownCard = {
  concept: ConceptMastery;
  lessonId: string;
  item: QuizItem;
};

function normAnswer(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

const choiceClass =
  "min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2.5 text-left text-sm leading-snug break-words text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]";

/**
 * Due concepts on the path overview. Questions come only from the lesson bank
 * (the quiz item and its teach-time alternate). Opening the list does not call a model.
 */
export function LearnReviewPanel({ plan, scope, progress, timeZone, gradeShort, onCommit, onAward }: Props) {
  const bank = useMemo(() => conceptItemBank(plan), [plan]);
  const queue = useMemo(() => reviewQueue(plan, progress.conceptMastery, Date.now()), [plan, progress.conceptMastery]);
  const [queueIds, setQueueIds] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"list" | "prompt" | "feedback">("list");
  const [graded, setGraded] = useState<GradeState | null>(null);
  const [retried, setRetried] = useState(false);
  const [busy, setBusy] = useState(false);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const onAwardRef = useRef(onAward);
  onAwardRef.current = onAward;
  const frozenRef = useRef<ShownCard | null>(null);

  const currentId = queueIds && index < queueIds.length ? queueIds[index]! : null;
  const liveCard = useMemo(() => {
    if (!currentId) return null;
    const items = bank.get(currentId);
    if (!items?.length) return null;
    const concept = Object.values(progress.conceptMastery).find((row) => row.conceptId === currentId);
    if (!concept) return null;
    const lessonId = reviewLessonId(plan, concept);
    const item = pickReviewItem(items, seen[currentId] ?? null);
    if (!lessonId || !item) return null;
    return { concept, lessonId, item };
  }, [currentId, bank, plan, progress.conceptMastery, seen]);

  if (phase === "prompt" && liveCard) frozenRef.current = liveCard;
  const card = phase === "feedback" ? frozenRef.current : liveCard;

  if (bank.size === 0) return null;

  const start = (conceptId?: string) => {
    const ids = queue.map((entry) => entry.concept.conceptId);
    if (!ids.length) return;
    const at = conceptId ? Math.max(0, ids.indexOf(conceptId)) : 0;
    setQueueIds([...ids.slice(at), ...ids.slice(0, at)]);
    setIndex(0);
    setSeen({});
    setGraded(null);
    setRetried(false);
    setPhase("prompt");
  };

  const closeSession = () => {
    setQueueIds(null);
    frozenRef.current = null;
    setGraded(null);
    setRetried(false);
    setPhase("list");
  };

  const submitShown = (result: GradeState, answer: LearnAttemptAnswer) => {
    if (!card) return;
    const key = conceptProgressKey(scope, card.concept.conceptId);
    const row =
      progressRef.current.conceptMastery[key] ??
      newConceptMastery({
        conceptId: card.concept.conceptId,
        conceptLabel: card.concept.conceptLabel,
        lessonId: card.lessonId,
      });
    const firstTry = result.correct && !result.skipped && !retried ? !(row.lastQuality != null && row.lastQuality < 3) : false;
    const quality = reviewQuality({
      correct: result.skipped ? null : result.correct,
      skipped: result.skipped,
      firstTry: result.correct && !result.skipped ? firstTry : undefined,
      previousQuality: row.lastQuality,
    });
    const now = Date.now();
    const posted: LearnAttemptAnswer = {
      ...answer,
      ...(result.skipped ? { skipped: true, correct: null } : {}),
      ...(result.correct && !result.skipped ? { firstTry } : {}),
      previousReviewedAt: row.lastReviewedAt,
    };
    onCommit((prev) => {
      const latest =
        prev.conceptMastery[key] ??
        newConceptMastery({
          conceptId: card.concept.conceptId,
          conceptLabel: card.concept.conceptLabel,
          lessonId: card.lessonId,
        });
      return withConceptMastery(
        prev,
        scope,
        card.concept.conceptId,
        scheduleConcept(
          { ...latest, conceptLabel: card.concept.conceptLabel || latest.conceptLabel, lessonId: card.lessonId },
          quality,
          now,
          timeZone,
        ),
      );
    });
    if (!result.skipped) {
      const outcome = result.correct ? "correct" : result.partial ? "partial" : "wrong";
      const amount = result.correct ? XP_QUIZ_CORRECT : result.partial ? XP_QUIZ_PARTIAL : XP_QUIZ_ATTEMPT;
      onAwardRef.current?.(
        `review:${scope.projectId}:${scope.planId}:${card.concept.conceptId}:${row.dueAt}:${row.lastReviewedAt ?? 0}:${outcome}`,
        amount,
      );
    }
    void postLearnAttempt(plan.id, {
      target: "review",
      lessonId: card.lessonId,
      timeZone,
      answers: [posted],
    }).then((body) => {
      if (!body?.conceptMastery) return;
      onCommit((prev) => keepFresherConceptMastery(prev, applyPlanMastery(prev, body.conceptMastery, scope)));
    });
    frozenRef.current = card;
    setGraded(result);
    setPhase("feedback");
  };

  const retry = () => {
    if (!card) return;
    setSeen((prev) => ({ ...prev, [card.concept.conceptId]: card.item.question }));
    setRetried(true);
    setGraded(null);
    setPhase("prompt");
  };

  const continueQueue = () => {
    const passed = graded?.correct === true && !graded.skipped;
    setGraded(null);
    setRetried(false);
    if (passed && currentId) setQueueIds((ids) => (ids ? ids.filter((id) => id !== currentId) : ids));
    else setIndex((value) => value + 1);
    setPhase("prompt");
  };

  const sessionOpen = queueIds !== null;
  const finished = sessionOpen && currentId === null;
  const position = queueIds ? Math.min(index + 1, queueIds.length) : 0;

  return (
    <section id="learn-review" className="mt-8 min-w-0" aria-label="Review">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--ink)]">Review</h2>
        {!sessionOpen ? (
          <p className="text-xs tabular-nums text-[var(--ink-muted)]">{queue.length} due</p>
        ) : finished ? null : (
          <p className="text-xs tabular-nums text-[var(--ink-muted)]">
            {position} of {queueIds?.length ?? 0}
          </p>
        )}
      </div>

      {!sessionOpen ? (
        queue.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
            Nothing is due right now. A miss comes back immediately. A correct answer comes back the next day.
          </p>
        ) : (
          <>
            <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto [scrollbar-gutter:stable]">
              {queue.map((entry) => (
                <li key={entry.concept.conceptId}>
                  <button
                    type="button"
                    onClick={() => start(entry.concept.conceptId)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-3 text-left hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]"
                  >
                    <span className="min-w-0 flex-1 break-words text-sm font-medium text-[var(--ink)]">
                      {entry.concept.conceptLabel}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--ink-muted)]">Due</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => start()}
              className="mt-3 min-h-11 w-full rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-4 py-3 text-sm font-medium text-[var(--ink)]"
            >
              Review {queue.length} {queue.length === 1 ? "concept" : "concepts"}
            </button>
          </>
        )
      ) : finished || !card ? (
        <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-4">
          <p className="text-sm leading-relaxed text-[var(--ink)]">
            {finished ? "That’s everything in this pass." : "This concept has no saved question."}
          </p>
          {queue.length > 0 ? (
            <button
              type="button"
              onClick={() => start()}
              className="mt-3 min-h-11 w-full rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] px-3 py-2 text-sm font-medium text-[var(--ink)]"
            >
              Review {queue.length} still due
            </button>
          ) : (
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Nothing else is due today.</p>
          )}
          <button
            type="button"
            onClick={closeSession}
            className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink-muted)]"
          >
            Back to the path
          </button>
        </div>
      ) : (
        <div className="mt-3 min-w-0 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_85%,var(--canvas))] px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">{card.concept.conceptLabel}</p>
          <p className="mt-2 break-words text-sm font-medium leading-relaxed text-[var(--ink)]">{card.item.question}</p>
          {phase === "prompt" ? (
            <ReviewPrompt
              key={`${card.concept.conceptId}:${card.item.question}`}
              item={card.item}
              busy={busy}
              onChoice={(choice) =>
                submitShown(
                  { correct: normAnswer(choice) === normAnswer(card.item.answer), partial: false, skipped: false },
                  {
                    conceptId: card.concept.conceptId,
                    conceptLabel: card.concept.conceptLabel,
                    mcChoice: choice,
                    shortText: "",
                    shortSubmitted: false,
                    correct: normAnswer(choice) === normAnswer(card.item.answer),
                  },
                )
              }
              onShort={(given) => {
                setBusy(true);
                void gradeShort(card.item, given)
                  .then((grade) => {
                    submitShown(
                      {
                        correct: grade.correct === true,
                        partial: grade.partial === true && grade.correct !== true,
                        skipped: false,
                      },
                      {
                        conceptId: card.concept.conceptId,
                        conceptLabel: card.concept.conceptLabel,
                        mcChoice: null,
                        shortText: given,
                        shortSubmitted: true,
                        correct: grade.correct === true,
                        ...(typeof grade.score === "number" ? { score: grade.score } : {}),
                      },
                    );
                  })
                  .finally(() => setBusy(false));
              }}
              onSkip={() =>
                submitShown(
                  { correct: false, partial: false, skipped: true },
                  {
                    conceptId: card.concept.conceptId,
                    conceptLabel: card.concept.conceptLabel,
                    mcChoice: null,
                    shortText: "",
                    shortSubmitted: false,
                    correct: null,
                    skipped: true,
                  },
                )
              }
            />
          ) : graded ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-[var(--ink)]">
                {graded.skipped ? "Skipped" : graded.correct ? "Correct" : graded.partial ? "Close" : "Not quite"}
              </p>
              {!graded.correct && !graded.skipped ? (
                <p className="mt-1 break-words text-sm text-[var(--ink-muted)]">
                  <span className="text-[var(--ink)]">Answer:</span> {card.item.answer}
                </p>
              ) : null}
              {card.item.rationale ? (
                <p className="mt-1 break-words text-sm leading-relaxed text-[var(--ink-muted)]">{card.item.rationale}</p>
              ) : null}
              <div className="mt-3 flex flex-col gap-2">
                {!graded.correct ? (
                  <button
                    type="button"
                    onClick={retry}
                    className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-sm font-medium text-[var(--ink)]"
                  >
                    Try again
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={continueQueue}
                  className="min-h-11 w-full rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-3 py-2 text-sm font-medium text-[var(--ink)]"
                >
                  {graded.correct ? "Next" : "Continue"}
                </button>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={closeSession}
            className="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--ink-muted)] underline-offset-2 hover:underline"
          >
            Close review
          </button>
        </div>
      )}
    </section>
  );
}

function ReviewPrompt({
  item,
  busy,
  onChoice,
  onShort,
  onSkip,
}: {
  item: QuizItem;
  busy: boolean;
  onChoice: (choice: string) => void;
  onShort: (given: string) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState("");
  const submitShort = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    onShort(text);
  };
  return (
    <div className="mt-3">
      {item.kind === "mc" && item.choices?.length ? (
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="sr-only">Choose one answer</legend>
          {item.choices.map((choice) => (
            <button key={choice} type="button" onClick={() => onChoice(choice)} className={choiceClass}>
              {choice}
            </button>
          ))}
        </fieldset>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={submitShort}>
          <label className="sr-only" htmlFor="review-short-answer">
            Your answer
          </label>
          <input
            id="review-short-answer"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
            placeholder="Type your answer"
            className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-sm font-medium text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Checking…" : "Check"}
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={onSkip}
        disabled={busy}
        className="mt-2 min-h-11 w-full rounded-lg px-3 py-2 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-45"
      >
        Skip
      </button>
    </div>
  );
}

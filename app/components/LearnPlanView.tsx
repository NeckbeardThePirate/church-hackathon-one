"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { bibleGatewayEsvUrl } from "../lib/bible/bible-gateway";
import { visibleCitationNote } from "../lib/learn/citation-note";
import { gradeShortAnswerLocal, type GradeResult } from "../lib/learn/grade-answer";
import { lessonMasteryPercent, xpReason, type DailyGoalStatus, type XpEventKind } from "../lib/learn/learner-stats";
import { postLearnAttempt } from "../lib/learn/post-attempt";
import {
  keepFresherConceptMastery,
  learnerTimeZone,
  reviewQuality,
  scheduleConcept,
  type ReviewQuality,
} from "../lib/learn/sm2";
import { locationForPlan, parsePathUrl, pathSearch } from "../lib/learn/path-url";
import {
  combineReadPercent,
  lessonCanBeMarkedRead,
  scrollDepthPercent,
  sectionVisibilityPercent,
} from "../lib/learn/read-progress";
import {
  applyPlanMastery,
  mirrorAttemptOntoProgress,
  submittedLessonAttempt,
  type LearnAttempt,
  type LearnAttemptAnswer,
} from "../lib/learn/attempts";
import {
  adoptLivePlan,
  groupMissesBySource,
  missedFromQuiz,
  missedGapConcepts,
  practiceCardHeading,
  practiceCards,
  selectGapConcepts,
  type GapConcept,
  type GapReserveResult,
  type PracticeCard,
} from "../lib/learn/gaps";
import {
  defaultLocation,
  emptyQuiz,
  isQuizSettled,
  quizAnswerSubmitted,
  releaseUntouchedAnswer,
  mainScrollElement,
  mergeLearnProgress,
  newConceptMastery,
  normalizeQuiz,
  quizAllAnswered,
  quizCorrectCount,
  resolveLocation,
  retryMissedQuiz,
  writeLearnProgress,
  type LearnLocation,
  type LearnPlanProgress,
  type PersistedQuiz,
  type PersistedQuizAnswer,
} from "../lib/learn/plan-progress";
import { courseContinue, pathProgressFigures } from "../lib/learn/progress-dashboard";
import { isStarterPlanId } from "../lib/learn/starters";
import { attemptPassed } from "../lib/learn/path-map";
import { lessonIsStudyable, pathMilestones } from "../lib/learn/path-milestones";
import {
  articleDoneFor,
  articleScrollFor,
  conceptProgressKey,
  FINAL_LESSON_ID,
  finalQuizFor,
  lessonQuizFor,
  readDoneFor,
  readScrollFor,
  withArticleDone,
  withArticleScroll,
  withConceptMastery,
  withFinalQuiz,
  withLessonQuiz,
  withReadState,
  type ProgressScope,
} from "../lib/learn/progress-scope";
import {
  lessonKind,
  type ArticleResource,
  type BookResource,
  type GapJobEvent,
  type Heartbeat,
  type LearnLesson,
  type LearnPlan,
  type LearnStage,
  type PlanSnapshot,
  type ProgressEvent,
  type QuizItem,
  librarySourceLabel,
  type LibraryCitation,
  type ScriptureReading,
  type TeachBlock,
  type VideoResource,
} from "../lib/learn/types";
import type { LearnReviewFocus } from "../lib/learn/agent-context";
import { ArticleReadWindow } from "./ArticleReadWindow";
import { LearnAgentFloat } from "./LearnAgentFloat";
import { LearnPathMap } from "./LearnPathMap";
import { OpenerQuiz } from "./OpenerQuiz";
import { PathBuildCard } from "./PathBuildCard";
import { StudyLamp } from "./StudyLamp";
import { StudyPlaceholder } from "./StudyLoading";
import { useIdsLeft } from "./useIdsLeft";
import { LearnReviewPanel } from "./LearnReviewPanel";
import { LearnerStatsPanel } from "./LearnerStatsPanel";
import { LessonVideoPlayer } from "./LessonVideoPlayer";
import { SourceNote } from "./SourceNote";
import { PROJECT_KIND_LABEL } from "../lib/projects";

type Props = {
  projectId: string;
  plan: LearnPlan;
  /** Set while the Learn queue is still generating lessons in the background. */
  buildingPlanId?: string;
  onBuildComplete?: (plan: LearnPlan) => void;
  displayTitle?: string;
  savedProgress?: LearnPlanProgress;
  onSaveProgress?: (projectId: string, progress: LearnPlanProgress) => void;
  onProgress?: (progress: LearnPlanProgress) => void;
  onAward?: (reason: string, kind: XpEventKind) => void;
  onPlan?: (plan: LearnPlan) => void;
  stats?: { xp: number; streak: number; timezone?: string | null } | null;
  goal?: DailyGoalStatus | null;
  focusRequest?: { nonce: number; location: LearnLocation; review: boolean } | null;
};

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type LessonScrollIntent = "top" | "restore";

function scrollMainToTop() {
  const el = mainScrollElement();
  if (!el) return;
  el.scrollTop = 0;
  requestAnimationFrame(() => {
    el.scrollTop = 0;
    requestAnimationFrame(() => {
      el.scrollTop = 0;
    });
  });
}

function perspectiveTag(p?: string): string | null {
  if (!p || p === "Unclear") return null;
  return p;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

function ResourceCard({
  title,
  meta,
  review,
  reviewNote,
  href,
}: {
  title: string;
  meta?: string;
  review?: string;
  reviewNote?: string;
  href: string;
}) {
  return (
    <li className="rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_90%,var(--canvas))] px-4 py-3">
      <p className="break-words text-sm font-medium leading-snug text-[var(--ink)]">
        <ExternalLink href={href}>{title}</ExternalLink>
      </p>
      {meta ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{meta}</p> : null}
      {review ? (
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
          {review}
          {reviewNote ? <span className="italic"> {reviewNote}</span> : null}
        </p>
      ) : null}
    </li>
  );
}

function CitationNote({ note }: { note: string }) {
  const caption = visibleCitationNote(note);
  if (!caption) return null;
  return <p className="mt-2 text-sm italic text-[var(--ink-muted)]">{caption}</p>;
}

function LibraryCallout({ item }: { item: LibraryCitation }) {
  const heading = item.condemned ? `${item.label} · condemned` : item.label;
  const origin = item.textSource === "bundled" ? "bundled" : "retrieved";
  return (
    <li className="rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_90%,var(--canvas))] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
        {librarySourceLabel(item.source)} · {origin}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-[var(--ink)]">
        {item.url ? <ExternalLink href={item.url}>{heading}</ExternalLink> : heading}
        {item.detail ? <span className="font-normal text-[var(--ink-muted)]"> · {item.detail}</span> : null}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">{item.text}</p>
      <CitationNote note={item.note} />
    </li>
  );
}

function scriptureEyebrow(reading: ScriptureReading): string {
  return reading.textSource === "bundled" ? "King James Version · bundled" : "Berean Study Bible · retrieved";
}

function ScriptureCallout({ reading }: { reading: ScriptureReading }) {
  const gatewayUrl = bibleGatewayEsvUrl(reading.reference);
  return (
    <aside
      className="my-4 rounded-xl border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--sidebar))] px-4 py-3"
      aria-label={`Scripture: ${reading.reference}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">{scriptureEyebrow(reading)}</p>
        <ExternalLink href={gatewayUrl}>
          <span className="break-words">
            {reading.reference}
            {reading.textSource === "bundled" ? " · compare the ESV" : " (ESV on Bible Gateway)"}
          </span>
        </ExternalLink>
      </div>
      <div
        className="bible-callout-body text-sm leading-relaxed text-[var(--ink)]"
        dangerouslySetInnerHTML={{ __html: esc(reading.text) }}
      />
      <CitationNote note={reading.note} />
    </aside>
  );
}

function TeachBlocks({ blocks }: { blocks: TeachBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === "divider") return <hr key={i} className="my-8 border-[var(--line)]" data-read-section />;
        const html = esc(block.text);
        switch (block.type) {
          case "heading1":
            return (
              <h3 key={i} data-read-section className="mt-8 text-xl font-semibold tracking-[-0.02em] text-[var(--ink)]">
                {block.text}
              </h3>
            );
          case "heading2":
            return (
              <h4 key={i} data-read-section className="mt-6 text-base font-semibold text-[var(--ink)]">
                {block.text}
              </h4>
            );
          case "bullet":
            return (
              <ul key={i} data-read-section className="my-2 list-disc pl-6 text-[var(--ink)]">
                <li className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
              </ul>
            );
          case "numbered":
            return (
              <ol key={i} data-read-section className="my-2 list-decimal pl-6 text-[var(--ink)]">
                <li className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
              </ol>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                data-read-section
                className="my-4 border-l-2 border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] pl-4 text-[var(--ink-muted)] italic"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          default:
            return (
              <p
                key={i}
                data-read-section
                className="my-3 text-[15px] leading-[1.65] text-[var(--ink)]"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
        }
      })}
    </>
  );
}

function normAnswer(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

async function gradeFreeText(planId: string, item: QuizItem, given: string): Promise<GradeResult> {
  try {
    const res = await fetch(`/api/learn/plans/${planId}/grade`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: item.question,
        expected: item.answer,
        given,
        ...(item.rationale ? { rationale: item.rationale } : {}),
      }),
    });
    const body = (await res.json().catch(() => null)) as GradeResult | null;
    if (res.ok && body && typeof body.correct === "boolean" && typeof body.score === "number") {
      return { correct: body.correct === true, partial: body.partial === true, score: body.score };
    }
  } catch {
    /* The semantic grader still accepts a paraphrase when the model is unreachable. */
  }
  return gradeShortAnswerLocal(given, item.answer);
}

function choiceButtonClass(state: "idle" | "picked" | "correct" | "wrong"): string {
  const base =
    "flex min-h-11 w-full items-center rounded-lg border px-3 py-2.5 text-left text-sm leading-snug transition-colors disabled:cursor-default";
  switch (state) {
    case "correct":
      return `${base} border-[color-mix(in_srgb,#6b9f7a_55%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_14%,var(--sidebar))] text-[var(--ink)]`;
    case "wrong":
      return `${base} border-[color-mix(in_srgb,#c97a7a_55%,var(--line))] bg-[color-mix(in_srgb,#c97a7a_12%,var(--sidebar))] text-[var(--ink)]`;
    case "picked":
      return `${base} border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_10%,var(--sidebar))] text-[var(--ink)]`;
    default:
      return `${base} border-[var(--line)] bg-[var(--sidebar)] text-[var(--ink)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] enabled:hover:bg-[color-mix(in_srgb,var(--accent)_6%,var(--sidebar))]`;
  }
}

function QuizFeedback({
  correct,
  partial,
  rationale,
  answer,
}: {
  correct: boolean;
  partial?: boolean;
  rationale: string;
  answer?: string;
}) {
  const title = correct ? "Correct" : partial ? "Close" : "Not quite";
  return (
    <div
      className={`mt-3 rounded-lg border px-3 py-2.5 text-sm leading-relaxed ${
        correct
          ? "border-[color-mix(in_srgb,#6b9f7a_40%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_8%,var(--canvas))] text-[var(--ink)]"
          : partial
            ? "border-[color-mix(in_srgb,var(--accent)_40%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--canvas))] text-[var(--ink)]"
            : "border-[color-mix(in_srgb,#c97a7a_40%,var(--line))] bg-[color-mix(in_srgb,#c97a7a_8%,var(--canvas))] text-[var(--ink)]"
      }`}
      role="status"
    >
      <p className="font-medium">{title}</p>
      {partial ? <p className="mt-1 text-[var(--ink-muted)]">Partial credit. The main idea is only partly there.</p> : null}
      {!correct && answer ? (
        <p className="mt-1 text-[var(--ink-muted)]">
          <span className="text-[var(--ink)]">Answer:</span> {answer}
        </p>
      ) : null}
      {rationale ? <p className="mt-1 text-[var(--ink-muted)]">{rationale}</p> : null}
    </div>
  );
}

function QuizQuestion({
  item,
  index,
  state,
  onChange,
  gradeShort,
}: {
  item: QuizItem;
  index: number;
  state: PersistedQuizAnswer;
  onChange: (next: PersistedQuizAnswer) => void;
  gradeShort: (item: QuizItem, given: string) => Promise<GradeResult>;
}) {
  const [grading, setGrading] = useState(false);
  const mcAnswered = state.mcChoice !== null;
  const mcCorrect = state.correct === true;
  const shortCorrect = state.shortSubmitted && state.correct === true;
  const shortPartial = state.shortSubmitted && !shortCorrect && (state.score ?? 0) >= 0.4;

  const handlePick = (choice: string) => {
    if (mcAnswered) return;
    onChange({
      mcChoice: choice,
      shortText: state.shortText,
      shortSubmitted: state.shortSubmitted,
      correct: normAnswer(choice) === normAnswer(item.answer),
    });
  };

  const handleShortSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (state.shortSubmitted || grading || !state.shortText.trim()) return;
    const given = state.shortText;
    setGrading(true);
    void gradeShort(item, given)
      .then((grade) => {
        onChange({
          ...state,
          shortText: given,
          shortSubmitted: true,
          correct: grade.correct,
          score: grade.score,
        });
      })
      .finally(() => setGrading(false));
  };

  return (
    <li className="rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_85%,var(--canvas))] px-4 py-4">
      <p className="text-sm font-medium leading-relaxed text-[var(--ink)]">
        <span className="text-[var(--ink-muted)]">{index + 1}.</span> {item.question}
      </p>

      {item.kind === "mc" && item.choices?.length ? (
        <fieldset className="mt-3 space-y-2" disabled={mcAnswered}>
          <legend className="sr-only">Choose one answer</legend>
          {item.choices.map((choice) => {
            const isCorrectChoice = normAnswer(choice) === normAnswer(item.answer);
            const isPicked = state.mcChoice === choice;
            let visual: "idle" | "picked" | "correct" | "wrong" = "idle";
            if (mcAnswered) {
              if (isCorrectChoice) visual = "correct";
              else if (isPicked) visual = "wrong";
            } else if (isPicked) visual = "picked";

            return (
              <button
                key={choice}
                type="button"
                onClick={() => handlePick(choice)}
                className={choiceButtonClass(visual)}
                aria-pressed={isPicked}
              >
                {choice}
              </button>
            );
          })}
        </fieldset>
      ) : (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start" onSubmit={handleShortSubmit}>
          <label className="sr-only" htmlFor={`quiz-short-${index}`}>
            Your answer
          </label>
          <input
            id={`quiz-short-${index}`}
            type="text"
            value={state.shortText}
            onChange={(event) =>
              onChange({
                ...state,
                shortText: event.target.value,
                shortSubmitted: false,
                correct: null,
              })
            }
            disabled={state.shortSubmitted || grading}
            placeholder="Type your answer"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] disabled:opacity-70"
          />
          <button
            type="submit"
            disabled={!state.shortText.trim() || state.shortSubmitted || grading}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {grading ? "Checking…" : "Check"}
          </button>
        </form>
      )}

      {item.kind === "mc" && mcAnswered && quizAnswerSubmitted(state) ? (
        <QuizFeedback correct={mcCorrect} rationale={item.rationale} answer={mcCorrect ? undefined : item.answer} />
      ) : null}
      {item.kind === "short" && quizAnswerSubmitted(state) ? (
        <QuizFeedback
          correct={shortCorrect}
          partial={shortPartial}
          rationale={item.rationale}
          answer={shortCorrect ? undefined : item.answer}
        />
      ) : null}
    </li>
  );
}

type GapWatch = { lessonId: string; message: string | null; error: string | null };

function PracticeList({
  cards,
  watch,
  onGenerate,
  onOpen,
}: {
  cards: PracticeCard[];
  watch: Record<string, GapWatch>;
  onGenerate: (sourceLessonId: string, concepts: GapConcept[]) => void;
  onOpen: (lessonId: string) => void;
}) {
  const arrived = useIdsLeft(cards.filter((card) => !card.gapLessonId).map((card) => card.key).join(","));
  if (!cards.length) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      {cards.map((card) => {
        const status = watch[card.sourceLessonId];
        const labels = card.concepts.map((concept) => concept.conceptLabel).filter(Boolean).join(", ");
        return (
          <div
            key={card.key}
            className={`rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_10%,var(--sidebar))] px-4 py-3 transition-[box-shadow,border-color] duration-500 ${
              arrived.has(card.key) ? "study-ready" : ""
            }`}
          >
            {card.gapLessonId ? (
              <button
                type="button"
                onClick={() => onOpen(card.gapLessonId!)}
                className="flex min-h-11 w-full flex-col items-start justify-center text-left"
              >
                <span className="text-sm font-medium text-[var(--ink)]">{practiceCardHeading(card)}</span>
                <span className="mt-1 text-xs text-[var(--ink-muted)]">Citations and a short quiz for what you missed.</span>
              </button>
            ) : status?.error ? (
              <>
                <p role="alert" className="text-sm text-[#c0533f]">
                  {status.error}
                </p>
                <button
                  type="button"
                  onClick={() => onGenerate(card.sourceLessonId, card.concepts)}
                  className="mt-2 flex min-h-11 w-full flex-col items-start justify-center text-left"
                >
                  <span className="text-sm font-medium text-[var(--ink)]">{practiceCardHeading(card)}</span>
                  {labels ? <span className="mt-1 text-xs text-[var(--ink-muted)]">{labels}</span> : null}
                </button>
              </>
            ) : status ? (
              <div role="status" aria-live="polite" className="study-rise flex items-start gap-3">
                <StudyLamp size={40} live />
                <div className="min-w-0 flex-1">
                  <p className="study-serif text-sm italic leading-snug text-[var(--ink)]">
                    Writing a short practice lesson
                  </p>
                  <p className="mt-1 break-words text-xs leading-relaxed text-[var(--ink-muted)]">
                    {status.message || `For what you missed${labels ? `: ${labels}` : ""}.`}
                  </p>
                  <span className="study-shimmer mt-3 block h-1 w-28 max-w-full rounded-full bg-[var(--line)]" />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onGenerate(card.sourceLessonId, card.concepts)}
                className="flex min-h-11 w-full flex-col items-start justify-center text-left"
              >
                <span className="text-sm font-medium text-[var(--ink)]">{practiceCardHeading(card)}</span>
                {labels ? <span className="mt-1 text-xs text-[var(--ink-muted)]">{labels}</span> : null}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuizSection({
  items,
  heading,
  saved,
  onSave,
  gradeShort,
}: {
  items: QuizItem[];
  heading: string;
  saved: PersistedQuiz;
  onSave: (quiz: PersistedQuiz) => void;
  gradeShort: (item: QuizItem, given: string) => Promise<GradeResult>;
}) {
  const quiz = normalizeQuiz(saved, items.length);
  const counted = quiz.answers.filter((answer) => quizAnswerSubmitted(answer) && answer.correct !== null);
  const answeredCount = counted.length;
  const correctCount = counted.filter((answer) => answer.correct === true).length;
  const bestCorrect = Math.max(quiz.bestCorrect ?? 0, correctCount);
  const missed = counted.some((answer) => answer.correct === false);
  const allAnswered = quizAllAnswered(quiz);

  const updateAnswer = (index: number, answer: PersistedQuizAnswer) => {
    const next = { ...quiz, answers: quiz.answers.map(releaseUntouchedAnswer) };
    next.answers[index] = releaseUntouchedAnswer(answer);
    onSave(next);
  };

  const retryMissed = () => onSave(retryMissedQuiz(quiz));

  if (!items.length) return null;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-base font-semibold text-[var(--ink)]">{heading}</h4>
        {answeredCount > 0 || bestCorrect > 0 ? (
          <p className="text-xs tabular-nums text-[var(--ink-muted)]">
            {correctCount}/{items.length} correct
            {bestCorrect > correctCount ? ` · best ${bestCorrect}/${items.length}` : ""}
            {allAnswered ? "" : answeredCount > 0 ? ` · ${answeredCount} answered` : ""}
          </p>
        ) : null}
      </div>
      <SourceNote place="quiz" />
      <ol className="mt-4 space-y-4">
        {items.map((item, i) => (
          <QuizQuestion
            key={i}
            item={item}
            index={i}
            state={quiz.answers[i] ?? emptyQuiz(1).answers[0]!}
            onChange={(answer) => updateAnswer(i, answer)}
            gradeShort={gradeShort}
          />
        ))}
      </ol>
      {missed ? (
        <button
          type="button"
          onClick={retryMissed}
          className="mt-4 flex min-h-11 w-full items-center rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-3 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)] sm:w-fit"
        >
          Try again
        </button>
      ) : null}
    </section>
  );
}

function videoMeta(v: VideoResource): string | undefined {
  const parts: string[] = [];
  if (v.channel) parts.push(v.channel);
  const tag = perspectiveTag(v.perspective);
  if (tag) parts.push(tag);
  return parts.length ? parts.join(" · ") : undefined;
}

function articleMeta(a: ArticleResource): string | undefined {
  const parts: string[] = [];
  if (a.siteName) parts.push(a.siteName);
  const tag = perspectiveTag(a.perspective);
  if (tag) parts.push(tag);
  return parts.length ? parts.join(" · ") : undefined;
}

function bookMeta(b: BookResource): string | undefined {
  const parts: string[] = [];
  if (b.authors.length) parts.push(b.authors.join(", "));
  if (b.year) parts.push(String(b.year));
  const tag = perspectiveTag(b.perspective);
  if (tag) parts.push(tag);
  return parts.length ? parts.join(" · ") : undefined;
}

function LearnProgressTrack({
  completed,
  total,
  percent,
  compact,
  label = "Progress",
}: {
  completed: number;
  total: number;
  percent: number;
  compact?: boolean;
  label?: string;
}) {
  if (total === 0) return null;
  return (
    <div
      className={
        compact
          ? "mb-5 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_90%,var(--canvas))] px-3 py-2.5"
          : "rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-3"
      }
    >
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">{label}</span>
        <span className="tabular-nums text-[var(--ink)]">{percent}%</span>
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-[var(--ink-muted)]">
        {completed}/{total} complete
      </p>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${completed} of ${total} steps complete`}
      >
        <div
          className="h-full rounded-full bg-[color-mix(in_srgb,var(--accent)_78%,var(--ink))] transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function StepMark({ done }: { done: boolean }) {
  return (
    <span
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${
        done
          ? "border-[color-mix(in_srgb,#6b9f7a_50%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_18%,var(--sidebar))] text-[color-mix(in_srgb,#6b9f7a_85%,var(--ink))]"
          : "border-[var(--line)] bg-transparent text-transparent"
      }`}
      aria-label={done ? "Completed" : "Not completed"}
    >
      {done ? "✓" : ""}
    </span>
  );
}

function LessonBody({
  lesson,
  total,
  planId,
  articleScroll,
  articleDone,
  openArticleUrl,
  onArticleOpen,
  onArticleScroll,
  onArticleDone,
}: {
  lesson: LearnLesson;
  total: number;
  planId: string;
  articleScroll: Record<string, number>;
  articleDone: Record<string, boolean>;
  openArticleUrl: string | null;
  onArticleOpen: (url: string | null) => void;
  onArticleScroll: (url: string, percent: number) => void;
  onArticleDone: (url: string, done: boolean) => void;
}) {
  const articlesDone = lesson.articles.filter((article) => articleDone[article.url]).length;
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  useEffect(() => {
    setPlayingVideo(null);
  }, [lesson.id]);
  if (lesson.status === "pending" && lesson.teaching.length === 0) {
    return (
      <StudyPlaceholder
        kicker={`Lesson ${lesson.order} of ${total}`}
        title={lesson.title || "This lesson"}
        caption="The teaching is still being written. It will open here as soon as the page is ready."
      />
    );
  }
  return (
    <>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        Lesson {lesson.order} of {total}
      </p>
      <h1 className="mt-2 break-words text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)] sm:text-3xl">{lesson.title}</h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        About {lesson.estimatedMinutes} min
        {lesson.status === "degraded" ? " · Some resources may be missing" : null}
        {lesson.status === "pending" ? " · The check is still being written" : null}
      </p>
      <SourceNote place="lesson" />

      {lesson.objectives.length ? (
        <div className="mt-6" data-read-section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-[var(--ink-muted)]">What you'll learn</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-[var(--ink)]">
            {lesson.objectives.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="learn-article-body mt-6">
        <TeachBlocks blocks={lesson.teaching} />
      </div>

      {lesson.videos.length ? (
        <div className="mt-8" data-read-section>
          <h2 className="text-base font-semibold text-[var(--ink)]">Watch</h2>
          <ul className="mt-3 space-y-3">
            {lesson.videos.map((v) => (
              <LessonVideoPlayer
                key={v.videoId || v.url}
                video={v}
                meta={videoMeta(v)}
                reviewNote={v.reviewBasis === "metadata" ? "(reviewed from description)" : undefined}
                playing={playingVideo === (v.videoId || v.url)}
                onPlay={() => setPlayingVideo(v.videoId || v.url)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.articles.length ? (
        <div className="mt-8" data-read-section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-[var(--ink)]">Read</h2>
            {articlesDone > 0 ? (
              <p className="text-xs tabular-nums text-[var(--ink-muted)]">
                {articlesDone}/{lesson.articles.length} complete
              </p>
            ) : null}
          </div>
          <ul className="mt-3 space-y-2">
            {lesson.articles.map((a) => (
              <ArticleReadWindow
                key={a.url}
                planId={planId}
                article={a}
                meta={articleMeta(a)}
                scroll={articleScroll[a.url] ?? 0}
                done={articleDone[a.url] === true}
                open={openArticleUrl === a.url}
                onOpenChange={(next) => onArticleOpen(next ? a.url : null)}
                onScroll={(percent) => onArticleScroll(a.url, percent)}
                onDone={(next) => onArticleDone(a.url, next)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.books.length ? (
        <div className="mt-8" data-read-section>
          <h2 className="text-base font-semibold text-[var(--ink)]">Books</h2>
          <ul className="mt-3 space-y-2">
            {lesson.books.map((b) => (
              <ResourceCard key={b.url} href={b.url} title={b.title} meta={bookMeta(b)} review={b.review} />
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.library?.length ? (
        <div className="mt-8" data-read-section>
          <h2 className="text-base font-semibold text-[var(--ink)]">Confessions, commentaries, and church fathers</h2>
          <ul className="mt-3 space-y-3">
            {lesson.library.map((item) => (
              <LibraryCallout key={`${item.source}-${item.id}`} item={item} />
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.scripture.length ? (
        <div className="mt-8" data-read-section>
          <h2 className="text-base font-semibold text-[var(--ink)]">Scripture readings</h2>
          {lesson.scripture.map((reading, i) => (
            <ScriptureCallout key={`${reading.reference}-${i}`} reading={reading} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function ReadingProgressBar({ percent, done, onMarkRead }: { percent: number; done: boolean; onMarkRead: () => void }) {
  const pct = Math.min(100, Math.max(0, done ? Math.max(percent, 100) : percent));
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">Reading</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="tabular-nums text-[var(--ink-muted)]">{pct}%</span>
          <button
            type="button"
            aria-pressed={done}
            onClick={onMarkRead}
            className={`min-h-11 rounded-md border px-3 text-xs font-medium ${
              done
                ? "border-[color-mix(in_srgb,#6b9f7a_50%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_18%,var(--sidebar))] text-[color-mix(in_srgb,#6b9f7a_85%,var(--ink))]"
                : "border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] text-[var(--ink)]"
            }`}
          >
            {done ? "Marked as read" : "Mark as read"}
          </button>
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={done ? "Marked as read" : `${pct} percent scrolled`}
      >
        <div
          className="h-full rounded-full bg-[color-mix(in_srgb,var(--accent)_78%,var(--ink))] transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function NavButton({
  children,
  onClick,
  active,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full gap-2 rounded-md px-1.5 py-1 text-left text-sm leading-snug transition-colors ${
        active
          ? "bg-[var(--sidebar-active)] text-[var(--ink)]"
          : "text-[var(--ink-muted)] hover:bg-[color-mix(in_srgb,var(--sidebar-active)_55%,transparent)] hover:text-[var(--ink)]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function rememberQuiz(quiz: PersistedQuiz): PersistedQuiz {
  const bestCorrect = Math.max(quiz.bestCorrect ?? 0, quizCorrectCount(quiz));
  const settled = quiz.settled === true || quizAllAnswered(quiz);
  return { ...quiz, bestCorrect, ...(settled ? { settled: true } : {}) };
}

function wasGraded(answer: PersistedQuizAnswer | undefined): boolean {
  if (!answer || !quizAnswerSubmitted(answer)) return false;
  if (answer.correct != null) return true;
  if ((answer.score ?? 0) > 0) return true;
  if (answer.shortSubmitted) return true;
  return Boolean(answer.mcChoice);
}

function awardQuizDelta(
  scope: ProgressScope,
  lessonKey: string,
  previous: PersistedQuiz | undefined,
  next: PersistedQuiz,
  award: ((reason: string, kind: XpEventKind) => void) | undefined,
  gap: boolean,
) {
  if (!award) return;
  const retry = isQuizSettled(previous);
  if (!retry) {
    next.answers.forEach((answer, index) => {
      if (answer.correct !== true || wasGraded(previous?.answers[index])) return;
      award(xpReason("first", [scope.projectId, scope.planId, lessonKey, String(index)]), "first");
    });
  }
  if (!retry && isQuizSettled(next)) {
    if (lessonKey === "final") award(xpReason("final", [scope.projectId, scope.planId]), "final");
    else award(xpReason("quiz", [scope.projectId, scope.planId, lessonKey]), "quiz");
  }
  if (gap && isQuizSettled(next) && attemptPassed(quizCorrectCount(next), next.answers.length)) {
    award(xpReason("gap", [scope.projectId, scope.planId, lessonKey]), "gap");
  }
}

type ConceptUpdate = {
  index: number;
  conceptId: string;
  conceptLabel: string;
  lessonId: string;
  quality: ReviewQuality;
  answer: LearnAttemptAnswer;
};

/**
 * One lesson post carries every answer. Only a concept whose grade just changed is scheduled.
 * The other answers stay on the quiz mirror and do not take another SM-2 step.
 */
function attemptAnswers(quiz: PersistedQuiz, items: QuizItem[], updates: ConceptUpdate[]): LearnAttemptAnswer[] {
  const updateByIndex = new Map(updates.map((update) => [update.index, update]));
  return quiz.answers.map((answer, index) => {
    const update = updateByIndex.get(index);
    return {
      ...(items[index]?.conceptId ? { conceptId: items[index]!.conceptId } : {}),
      ...(items[index]?.conceptLabel ? { conceptLabel: items[index]!.conceptLabel } : {}),
      mcChoice: answer.mcChoice,
      shortText: answer.shortText,
      shortSubmitted: answer.shortSubmitted,
      correct: answer.correct,
      ...(typeof answer.score === "number" ? { score: answer.score } : {}),
      ...(update
        ? {
            ...(update.answer.firstTry === true || update.answer.firstTry === false ? { firstTry: update.answer.firstTry } : {}),
            previousReviewedAt: update.answer.previousReviewedAt,
          }
        : { applySchedule: false }),
    };
  });
}

/** One SM-2 step per concept whose grade just changed. */
function conceptUpdatesForQuiz(
  progress: LearnPlanProgress,
  scope: ProgressScope,
  lessonId: string,
  items: QuizItem[],
  previous: PersistedQuiz | undefined,
  next: PersistedQuiz,
): ConceptUpdate[] {
  const storedLesson = lessonId === "final" ? "final" : lessonId;
  const byId = new Map<string, ConceptUpdate>();
  items.forEach((item, index) => {
    if (!item.conceptId) return;
    const answer = next.answers[index];
    const before = previous?.answers[index];
    if (!answer || !quizAnswerSubmitted(answer) || answer.correct == null) return;
    if (before && before.correct === answer.correct && (before.score ?? null) === (answer.score ?? null)) return;
    const key = conceptProgressKey(scope, item.conceptId);
    const row =
      progress.conceptMastery[key] ??
      newConceptMastery({
        conceptId: item.conceptId,
        conceptLabel: item.conceptLabel || item.conceptId,
        lessonId: storedLesson,
      });
    const firstTry = answer.correct === true ? !(row.lastQuality != null && row.lastQuality < 3) : undefined;
    const quality = reviewQuality({
      correct: answer.correct,
      firstTry,
      previousQuality: row.lastQuality,
    });
    byId.set(item.conceptId, {
      index,
      conceptId: item.conceptId,
      conceptLabel: item.conceptLabel || row.conceptLabel,
      lessonId: storedLesson,
      quality,
      answer: {
        conceptId: item.conceptId,
        conceptLabel: item.conceptLabel || row.conceptLabel,
        mcChoice: answer.mcChoice,
        shortText: answer.shortText,
        shortSubmitted: answer.shortSubmitted,
        correct: answer.correct,
        ...(typeof answer.score === "number" ? { score: answer.score } : {}),
        ...(firstTry === true || firstTry === false ? { firstTry } : {}),
        previousReviewedAt: row.lastReviewedAt,
      },
    });
  });
  return [...byId.values()];
}

function applyConceptUpdates(
  progress: LearnPlanProgress,
  scope: ProgressScope,
  updates: ConceptUpdate[],
  now: number,
  timeZone: string,
): LearnPlanProgress {
  let next = progress;
  for (const update of updates) {
    const key = conceptProgressKey(scope, update.conceptId);
    const row =
      next.conceptMastery[key] ??
      newConceptMastery({
        conceptId: update.conceptId,
        conceptLabel: update.conceptLabel,
        lessonId: update.lessonId,
      });
    next = withConceptMastery(
      next,
      scope,
      update.conceptId,
      scheduleConcept(
        { ...row, conceptLabel: update.conceptLabel, lessonId: update.lessonId },
        update.quality,
        now,
        timeZone,
      ),
    );
  }
  return next;
}

function quizStillMatches(quiz: PersistedQuiz | null | undefined, answers: LearnAttemptAnswer[]): boolean {
  if (!quiz || quiz.answers.length !== answers.length) return false;
  return answers.every((answer, index) => {
    const current = quiz.answers[index];
    return (
      current?.mcChoice === answer.mcChoice &&
      current.shortText === answer.shortText &&
      current.shortSubmitted === answer.shortSubmitted &&
      current.correct === answer.correct
    );
  });
}

/** One automatic retry. A non-2xx body still returns so the caller can show it inline. */
async function postGapLesson(planId: string, sourceLessonId: string, concepts: GapConcept[]): Promise<GapReserveResult> {
  let lastError = "Could not start the practice lesson. The rest of the path is unchanged.";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`/api/learn/plans/${planId}/gaps`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceLessonId, concepts }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<GapReserveResult> & { error?: string };
      if (response.ok) {
        return {
          queued: body.queued === true,
          ...(typeof body.lessonId === "string" ? { lessonId: body.lessonId } : {}),
          conceptIds: Array.isArray(body.conceptIds) ? body.conceptIds : [],
          skipped: Array.isArray(body.skipped) ? body.skipped : [],
          ...(typeof body.error === "string" ? { error: body.error } : {}),
        };
      }
      if (typeof body.error === "string" && body.error) lastError = body.error;
      if (response.status < 500) break;
    } catch {
      /* Network failure. Retry once. */
    }
  }
  return { queued: false, conceptIds: [], skipped: [], error: lastError };
}

function applyRead(
  prev: LearnPlanProgress,
  scope: ProgressScope,
  lessonId: string,
  percent: number,
  forceDone = false,
): LearnPlanProgress {
  const current = readScrollFor(prev, scope, lessonId);
  const alreadyDone = readDoneFor(prev, scope, lessonId);
  const nextPct = Math.min(100, Math.max(current, forceDone ? 100 : Math.round(percent)));
  // Scrolling only moves the bar. "Mark as read" is the credit.
  const done = forceDone || alreadyDone;
  if (current === nextPct && alreadyDone === done) return prev;
  return withReadState(prev, scope, lessonId, nextPct, done);
}

export function LearnPlanView({
  projectId,
  plan: incomingPlan,
  buildingPlanId,
  onBuildComplete,
  displayTitle,
  savedProgress,
  onSaveProgress,
  onProgress,
  onAward,
  onPlan,
  stats,
  goal = null,
  focusRequest = null,
}: Props) {
  const [plan, setPlan] = useState(incomingPlan);
  const planStateRef = useRef(plan);
  planStateRef.current = plan;
  const incomingRef = useRef(incomingPlan);
  incomingRef.current = incomingPlan;
  const title = displayTitle?.trim() || plan.title.trim() || plan.topic;
  const totalMin = plan.lessons.reduce((n, l) => n + l.estimatedMinutes, 0);
  const roundedMin = Math.round(totalMin / 5) * 5;
  const hasFinal = plan.finalAssessment.length > 0;
  const scope = useMemo<ProgressScope>(() => ({ projectId, planId: plan.id }), [projectId, plan.id]);

  const hydrated = useMemo(
    () => mergeLearnProgress(savedProgress, scope),
    [savedProgress, scope],
  );

  const [progress, setProgress] = useState<LearnPlanProgress>(hydrated);
  const [showPlanNotes, setShowPlanNotes] = useState(false);
  const [location, setLocation] = useState<LearnLocation>(() => resolveLocation(plan.lessons, hydrated.location));
  const [reviewFocus, setReviewFocus] = useState<LearnReviewFocus | null>(null);
  const [buildStage, setBuildStage] = useState<LearnStage | undefined>(undefined);
  const [buildCounts, setBuildCounts] = useState<{ done: number; total: number } | null>(null);
  const [openerSettled, setOpenerSettled] = useState(false);

  const saveTimerRef = useRef<number | null>(null);
  const lessonScrollIntentRef = useRef<LessonScrollIntent>("restore");
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const onSaveProgressRef = useRef(onSaveProgress);
  onSaveProgressRef.current = onSaveProgress;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onAwardRef = useRef(onAward);
  onAwardRef.current = onAward;
  const onPlanRef = useRef(onPlan);
  onPlanRef.current = onPlan;

  useEffect(() => {
    setOpenerSettled(false);
  }, [buildingPlanId]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/providers", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (cancelled || !body || typeof body !== "object") return;
        if ((body as { dev?: unknown }).dev === true) setShowPlanNotes(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPlan((current) => {
      const base = current.id === incomingPlan.id ? current : incomingPlan;
      const merged = adoptLivePlan(base, incomingPlan);
      planStateRef.current = merged;
      return merged;
    });
  }, [incomingPlan]);

  useEffect(() => {
    if (buildingPlanId && buildingPlanId === incomingPlan.id) return;
    // A starter path is already complete in the workspace. There is no plan object to refresh.
    if (isStarterPlanId(incomingPlan.id)) return;
    let cancelled = false;
    const planId = incomingPlan.id;
    void fetch(`/api/learn/plans/${planId}?view=plan`, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (cancelled) return;
        const live = (body as PlanSnapshot | null)?.plan;
        if (!live || live.id !== planId) return;
        const current = planStateRef.current;
        const base = current.id === planId ? current : incomingRef.current;
        const merged = adoptLivePlan(base, live);
        if (merged === current) return;
        planStateRef.current = merged;
        setPlan(merged);
        onPlanRef.current?.(merged);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [buildingPlanId, incomingPlan.id]);

  const onBuildCompleteRef = useRef(onBuildComplete);
  onBuildCompleteRef.current = onBuildComplete;

  useEffect(() => {
    if (!buildingPlanId || buildingPlanId !== incomingPlan.id) return;
    let closed = false;
    let inflight = false;
    let queued = false;
    let queuedForce = false;
    let lastSig = "";
    const source = new EventSource(`/api/learn/plans/${buildingPlanId}/events`);
    const absorbLive = (snap: PlanSnapshot | null) => {
      if (!snap?.plan || closed) return;
      const current = planStateRef.current;
      const merged = adoptLivePlan(current, snap.plan);
      if (merged === current) return;
      planStateRef.current = merged;
      setPlan(merged);
      onPlanRef.current?.(merged);
    };
    const finishIfDone = (snap: PlanSnapshot) => {
      absorbLive(snap);
      if (snap.status === "complete" || snap.status === "partial") {
        closed = true;
        source.close();
        if (snap.plan) onBuildCompleteRef.current?.(snap.plan);
      }
    };
    const rosterSig = (roster: { status?: string; lessonsDone?: number; lessonIds?: string[] }) =>
      `${roster.status ?? ""}|${roster.lessonsDone ?? ""}|${(roster.lessonIds ?? []).join(",")}`;
    const pull = (force: boolean) => {
      if (closed) return;
      if (inflight) {
        queued = true;
        queuedForce = queuedForce || force;
        return;
      }
      inflight = true;
      void fetch(`/api/learn/plans/${buildingPlanId}?view=roster`, { credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : null))
        .then(async (body: unknown) => {
          if (closed || !body || typeof body !== "object") return;
          const roster = body as { status?: string; lessonsDone?: number; lessonIds?: string[] };
          const sig = rosterSig(roster);
          if (!force && sig === lastSig) return;
          const response = await fetch(`/api/learn/plans/${buildingPlanId}?view=plan`, { credentials: "same-origin" });
          const snap = response.ok ? ((await response.json()) as PlanSnapshot) : null;
          if (!snap || closed) return;
          lastSig = sig;
          if (snap.status === "complete" || snap.status === "partial") finishIfDone(snap);
          else absorbLive(snap);
          if (force && !closed) {
            const fresh = await fetch(`/api/learn/plans/${buildingPlanId}?view=roster`, { credentials: "same-origin" });
            if (fresh.ok) lastSig = rosterSig((await fresh.json()) as { status?: string; lessonsDone?: number; lessonIds?: string[] });
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inflight = false;
          if (queued && !closed) {
            const nextForce = queuedForce;
            queued = false;
            queuedForce = false;
            pull(nextForce);
          }
        });
    };
    source.addEventListener("done", (event) => {
      finishIfDone(JSON.parse((event as MessageEvent).data) as PlanSnapshot);
    });
    source.addEventListener("progress", (event) => {
      const progressEvent = JSON.parse((event as MessageEvent).data) as ProgressEvent;
      if (!closed) setBuildStage(progressEvent.stage);
      if (progressEvent.stage === "check" || progressEvent.stage === "assemble") pull(true);
    });
    source.addEventListener("heartbeat", (event) => {
      if (closed) return;
      const beat = JSON.parse((event as MessageEvent).data) as Heartbeat;
      setBuildCounts({ done: beat.lessonsDone, total: beat.lessonsTotal });
    });
    source.onerror = () => {
      if (!closed) pull(true);
    };
    pull(false);
    const poll = window.setInterval(() => pull(false), 8000);
    return () => {
      closed = true;
      source.close();
      window.clearInterval(poll);
    };
  }, [buildingPlanId, incomingPlan.id]);

  const gapPostedRef = useRef<Set<string>>(new Set());
  const [gapWatch, setGapWatch] = useState<Record<string, GapWatch>>({});
  const urlAppliedRef = useRef(false);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    onProgressRef.current?.(progressRef.current);
  }, [projectId]);

  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const current = scopeRef.current;
      onSaveProgressRef.current?.(current.projectId, progressRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const commitProgress = useCallback(
    (updater: (prev: LearnPlanProgress) => LearnPlanProgress, immediate = false) => {
      const prev = progressRef.current;
      const next = updater(prev);
      if (next === prev) return;
      progressRef.current = next;
      setProgress(next);
      writeLearnProgress(projectId, next);
      onProgressRef.current?.(next);
      for (const lesson of plan.lessons) {
        if (readDoneFor(next, scope, lesson.id) && !readDoneFor(prev, scope, lesson.id)) {
          onAwardRef.current?.(xpReason("read", [projectId, plan.id, lesson.id]), "read");
          if (lessonKind(lesson) === "gap" && lesson.quiz.length === 0) {
            onAwardRef.current?.(xpReason("gap", [projectId, plan.id, lesson.id]), "gap");
          }
        }
      }
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (immediate) {
        saveTimerRef.current = null;
        onSaveProgressRef.current?.(projectId, next);
        return;
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        onSaveProgressRef.current?.(projectId, next);
      }, 450);
    },
    [plan.id, plan.lessons, projectId, scope],
  );

  const navigate = useCallback(
    (loc: LearnLocation, scroll?: LessonScrollIntent) => {
      const resolved = resolveLocation(plan.lessons, loc);
      const intent = scroll ?? (resolved.screen === "lesson" ? "restore" : "top");
      lessonScrollIntentRef.current = intent;
      setLocation(resolved);
      commitProgress((prev) => ({ ...prev, location: resolved }));
      if (intent === "top") scrollMainToTop();
    },
    [commitProgress, plan.lessons],
  );

  useEffect(() => {
    const lessonIds = plan.lessons.map((lesson) => lesson.id);
    if (!urlAppliedRef.current) {
      urlAppliedRef.current = true;
      const fromUrl = locationForPlan(parsePathUrl(window.location.search).location, lessonIds);
      if (fromUrl) {
        const resolved = resolveLocation(plan.lessons, fromUrl);
        setLocation(resolved);
        commitProgress((prev) =>
          prev.location.screen === resolved.screen && prev.location.lessonId === resolved.lessonId
            ? prev
            : { ...prev, location: resolved },
        );
        return;
      }
    }
    const next = pathSearch(projectId, location, window.location.search);
    if (window.location.search === next) return;
    window.history.replaceState(null, "", next ? `/${next}` : "/");
  }, [location, projectId, plan.lessons, commitProgress]);

  useEffect(() => {
    const onPop = () => {
      const fromUrl = locationForPlan(parsePathUrl(window.location.search).location, plan.lessons.map((lesson) => lesson.id));
      if (!fromUrl || parsePathUrl(window.location.search).pathId !== projectId) return;
      urlAppliedRef.current = true;
      const resolved = resolveLocation(plan.lessons, fromUrl);
      setLocation(resolved);
      commitProgress((prev) => ({ ...prev, location: resolved }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [plan.lessons, projectId, commitProgress]);

  const goOverview = useCallback(() => navigate(defaultLocation(), "top"), [navigate]);
  const goLesson = useCallback(
    (lessonId: string, scroll?: LessonScrollIntent) => navigate({ screen: "lesson", lessonId }, scroll),
    [navigate],
  );
  const goFinal = useCallback(() => navigate({ screen: "final" }, "top"), [navigate]);

  const [openArticleUrl, setOpenArticleUrl] = useState<string | null>(null);
  const onArticleOpen = useCallback((url: string | null) => setOpenArticleUrl(url), []);
  const onArticleScroll = useCallback(
    (url: string, percent: number) => {
      commitProgress((prev) => {
        if (articleScrollFor(prev, scope, url) === percent) return prev;
        return withArticleScroll(prev, scope, url, percent);
      });
    },
    [commitProgress, scope],
  );
  const onArticleDone = useCallback(
    (url: string, done: boolean) => {
      commitProgress((prev) => withArticleDone(prev, scope, url, done));
    },
    [commitProgress, scope],
  );

  const pathFigures = pathProgressFigures({
    lessons: plan.lessons,
    finalAssessment: hasFinal ? plan.finalAssessment : [],
    progress,
    scope,
    now: Date.now(),
  });

  const activeLesson =
    location.screen === "lesson" && location.lessonId
      ? plan.lessons.find((l) => l.id === location.lessonId)
      : undefined;

  const lessonIndex = activeLesson ? plan.lessons.findIndex((l) => l.id === activeLesson.id) : -1;
  const prevLesson = lessonIndex > 0 ? plan.lessons[lessonIndex - 1] : undefined;
  const nextLesson = lessonIndex >= 0 && lessonIndex < plan.lessons.length - 1 ? plan.lessons[lessonIndex + 1] : undefined;

  useLessonScrollPersistence(
    lessonCanBeMarkedRead(activeLesson) ? activeLesson?.id : undefined,
    scope,
    activeLesson ? readScrollFor(progress, scope, activeLesson.id) : 0,
    commitProgress,
    lessonScrollIntentRef,
  );

  useEffect(() => {
    setOpenArticleUrl(null);
  }, [activeLesson?.id]);

  const resume = courseContinue(
    {
      id: projectId,
      title,
      updatedAt: 0,
      learnPlan: plan,
      learnProgress: progress,
    },
    Date.now(),
  );

  const gradeShort = useCallback((item: QuizItem, given: string) => gradeFreeText(plan.id, item, given), [plan.id]);
  const timeZone = learnerTimeZone(stats?.timezone);

  const queuePractice = useCallback(
    async (sourceLessonId: string, concepts: GapConcept[], force = false) => {
      const source = plan.lessons.find((lesson) => lesson.id === sourceLessonId);
      if (!source || lessonKind(source) === "gap" || !concepts.length) return;
      const selection = selectGapConcepts(plan.lessons, sourceLessonId, concepts);
      if (!selection.concepts.length) {
        if (selection.error) {
          setGapWatch((prev) => ({
            ...prev,
            [sourceLessonId]: { lessonId: prev[sourceLessonId]?.lessonId ?? "", message: null, error: selection.error ?? null },
          }));
        }
        return;
      }
      const key = `${sourceLessonId}:${selection.concepts.map((concept) => concept.conceptId).sort().join(",")}`;
      if (!force && gapPostedRef.current.has(key)) return;
      gapPostedRef.current.add(key);
      const labels = selection.concepts.map((concept) => concept.conceptLabel).join(", ");
      setGapWatch((prev) => ({
        ...prev,
        [sourceLessonId]: {
          lessonId: prev[sourceLessonId]?.lessonId ?? "",
          message: `Building a short practice lesson for ${labels}…`,
          error: null,
        },
      }));
      const reserved = await postGapLesson(plan.id, sourceLessonId, selection.concepts);
      if (reserved.lessonId && plan.lessons.some((lesson) => lesson.id === reserved.lessonId)) {
        setGapWatch((prev) => {
          const next = { ...prev };
          delete next[sourceLessonId];
          return next;
        });
        return;
      }
      if (reserved.error && !reserved.lessonId) {
        gapPostedRef.current.delete(key);
        setGapWatch((prev) => ({
          ...prev,
          [sourceLessonId]: { lessonId: "", message: null, error: reserved.error ?? "Could not start the practice lesson." },
        }));
        return;
      }
      if (!reserved.lessonId) {
        setGapWatch((prev) => {
          const next = { ...prev };
          delete next[sourceLessonId];
          return next;
        });
        return;
      }
      setGapWatch((prev) => ({
        ...prev,
        [sourceLessonId]: {
          lessonId: reserved.lessonId!,
          message: prev[sourceLessonId]?.message ?? `Building a short practice lesson for ${labels}…`,
          error: null,
        },
      }));
    },
    [plan.id, plan.lessons],
  );

  const requestPractice = useCallback(
    (target: "lesson" | "final", lessonKey: string, attempt: LearnAttempt) => {
      const missed = missedGapConcepts(attempt.answers);
      if (!missed.length) return;
      const requests =
        target === "final" ? groupMissesBySource(plan.lessons, missed) : [{ sourceLessonId: lessonKey, concepts: missed }];
      for (const request of requests) void queuePractice(request.sourceLessonId, request.concepts);
    },
    [plan.lessons, queuePractice],
  );

  const saveQuiz = useCallback(
    (lessonKey: string, items: QuizItem[], quiz: PersistedQuiz, target: "lesson" | "final") => {
      const stored = rememberQuiz(quiz);
      const previous =
        target === "final"
          ? (finalQuizFor(progressRef.current, scope) ?? undefined)
          : lessonQuizFor(progressRef.current, scope, lessonKey);
      const updates = conceptUpdatesForQuiz(progressRef.current, scope, lessonKey, items, previous, stored);
      const source = plan.lessons.find((lesson) => lesson.id === lessonKey);
      awardQuizDelta(scope, lessonKey, previous, stored, onAwardRef.current, source ? lessonKind(source) === "gap" : false);
      const reviewedAt = Date.now();
      commitProgress((prev) => {
        const withQuiz =
          target === "final"
            ? withFinalQuiz(prev, scope, stored)
            : withReadState(
                withLessonQuiz(prev, scope, lessonKey, stored),
                scope,
                lessonKey,
                readScrollFor(prev, scope, lessonKey),
                stored.settled ? true : readDoneFor(prev, scope, lessonKey),
              );
        return applyConceptUpdates(withQuiz, scope, updates, reviewedAt, timeZone);
      }, true);
      const answers = attemptAnswers(stored, items, updates);
      const attempt = submittedLessonAttempt(target, lessonKey, answers);
      const changed = stored.answers.some((answer, index) => answer.correct !== (previous?.answers[index]?.correct ?? null));
      const adoptMastery = (body: { conceptMastery?: LearnPlanProgress["conceptMastery"] } | null) => {
        const mastery = body?.conceptMastery;
        if (!mastery) return;
        commitProgress((prev) => {
          const current = target === "final" ? finalQuizFor(prev, scope) : lessonQuizFor(prev, scope, lessonKey);
          const merged =
            attempt && quizStillMatches(current, answers)
              ? mirrorAttemptOntoProgress(prev, attempt, mastery, scope)
              : applyPlanMastery(prev, mastery, scope);
          return keepFresherConceptMastery(prev, merged);
        }, true);
      };
      if (attempt && changed) {
        void postLearnAttempt(plan.id, { ...attempt, timeZone }).then(adoptMastery);
        requestPractice(target, lessonKey, attempt);
        return;
      }
      for (const update of updates) {
        void postLearnAttempt(plan.id, {
          target: "review",
          lessonId: update.lessonId,
          timeZone,
          answers: [update.answer],
        }).then(adoptMastery);
      }
    },
    [commitProgress, plan.id, plan.lessons, requestPractice, scope, timeZone],
  );

  const watchKey = Object.values(gapWatch)
    .map((watch) => watch.lessonId)
    .filter(Boolean)
    .sort()
    .join(",");

  const focusNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || focusNonceRef.current === focusRequest.nonce) return;
    focusNonceRef.current = focusRequest.nonce;
    navigate(focusRequest.location, "top");
    if (!focusRequest.review) return;
    const timer = window.setTimeout(() => document.getElementById("learn-review")?.scrollIntoView({ block: "start" }), 60);
    return () => window.clearTimeout(timer);
  }, [focusRequest, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("review") !== "1" || location.screen !== "overview") return;
    const timer = window.setTimeout(() => document.getElementById("learn-review")?.scrollIntoView({ block: "start" }), 60);
    params.delete("review");
    const text = params.toString();
    window.history.replaceState(null, "", text ? `/?${text}` : "/");
    return () => window.clearTimeout(timer);
  }, [location.screen]);

  useEffect(() => {
    if (!watchKey) return;
    let closed = false;
    const ids = new Set(watchKey.split(","));
    const source = new EventSource(`/api/learn/plans/${plan.id}/events`);
    const applyPlan = (next: LearnPlan | undefined) => {
      if (next) onPlanRef.current?.(next);
    };
    const absorb = (next: LearnPlan | undefined, error?: string, lessonId?: string) => {
      applyPlan(next);
      const ready = new Set(next?.lessons.map((lesson) => lesson.id) ?? []);
      setGapWatch((prev) => {
        const updated = { ...prev };
        let changed = false;
        for (const [sourceId, watch] of Object.entries(updated)) {
          if (!watch.lessonId || !ids.has(watch.lessonId)) continue;
          if (lessonId && watch.lessonId !== lessonId) continue;
          if (ready.has(watch.lessonId)) {
            delete updated[sourceId];
            changed = true;
            continue;
          }
          if (error) {
            updated[sourceId] = { ...watch, message: null, error };
            changed = true;
          }
        }
        return changed ? updated : prev;
      });
    };
    let inflight = false;
    const pull = () => {
      if (closed || inflight) return;
      inflight = true;
      void fetch(`/api/learn/plans/${plan.id}?view=roster`, { credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : null))
        .then(async (body: unknown) => {
          const lessonIds = (body as { lessonIds?: string[] } | null)?.lessonIds ?? [];
          if (closed || !lessonIds.some((id) => ids.has(id))) return;
          const response = await fetch(`/api/learn/plans/${plan.id}?view=plan`, { credentials: "same-origin" });
          const snap = response.ok ? ((await response.json()) as PlanSnapshot) : null;
          if (!snap?.plan || closed) return;
          if (snap.plan.lessons.some((lesson) => ids.has(lesson.id))) absorb(snap.plan);
        })
        .catch(() => undefined)
        .finally(() => {
          inflight = false;
        });
    };
    source.addEventListener("gap", (event) => {
      const body = JSON.parse((event as MessageEvent).data) as GapJobEvent;
      if (body.lessonId && !ids.has(body.lessonId)) return;
      absorb(body.plan, body.error, body.lessonId);
    });
    source.addEventListener("progress", (event) => {
      const progressEvent = JSON.parse((event as MessageEvent).data) as ProgressEvent;
      if (!progressEvent.lessonId || !ids.has(progressEvent.lessonId)) return;
      setGapWatch((prev) => {
        const updated = { ...prev };
        let changed = false;
        for (const [sourceId, watch] of Object.entries(updated)) {
          if (watch.lessonId !== progressEvent.lessonId) continue;
          updated[sourceId] =
            progressEvent.stage === "error"
              ? { ...watch, message: null, error: progressEvent.message }
              : { ...watch, message: progressEvent.message, error: null };
          changed = true;
        }
        return changed ? updated : prev;
      });
    });
    source.addEventListener("done", (event) => {
      const snap = JSON.parse((event as MessageEvent).data) as PlanSnapshot;
      if (snap.plan?.lessons.some((lesson) => ids.has(lesson.id))) absorb(snap.plan);
    });
    source.onerror = () => {
      if (!closed) pull();
    };
    const poll = window.setInterval(pull, 3000);
    return () => {
      closed = true;
      source.close();
      window.clearInterval(poll);
    };
  }, [watchKey, plan.id]);

  const practice = useMemo(() => {
    const bySource = new Map<string, GapConcept[]>();
    const add = (sourceLessonId: string, concepts: GapConcept[]) => {
      const list = bySource.get(sourceLessonId) ?? [];
      for (const concept of concepts) {
        if (!list.some((item) => item.conceptId === concept.conceptId)) list.push(concept);
      }
      if (list.length) bySource.set(sourceLessonId, list);
    };
    for (const lesson of plan.lessons) {
      if (lessonKind(lesson) === "gap") continue;
      const saved = lessonQuizFor(progress, scope, lesson.id);
      if (!saved || !isQuizSettled(saved)) continue;
      add(lesson.id, missedFromQuiz(lesson.quiz, saved.answers));
    }
    const finalSaved = hasFinal ? finalQuizFor(progress, scope) : null;
    const finalMisses =
      finalSaved && isQuizSettled(finalSaved) ? missedFromQuiz(plan.finalAssessment, finalSaved.answers) : [];
    for (const request of groupMissesBySource(plan.lessons, finalMisses)) add(request.sourceLessonId, request.concepts);
    const cards = practiceCards(
      plan.lessons,
      [...bySource].map(([sourceLessonId, concepts]) => ({ sourceLessonId, concepts })),
    );
    return { cards, finalSources: new Set(groupMissesBySource(plan.lessons, finalMisses).map((request) => request.sourceLessonId)) };
  }, [hasFinal, plan.finalAssessment, plan.lessons, progress, scope]);

  const buildMilestones = useMemo(() => {
    const core = plan.lessons.filter((lesson) => lessonKind(lesson) === "core");
    const readyCore = core.filter((lesson) => lesson.status !== "pending").length;
    const starter = core.filter(lessonIsStudyable).sort((a, b) => a.order - b.order)[0];
    return {
      starter,
      milestones: pathMilestones({
        stage: buildStage,
        status: "running",
        lessonsDone: Math.max(buildCounts?.done ?? 0, readyCore),
        lessonsTotal: Math.max(buildCounts?.total ?? 0, core.length),
        lessonOneReady: Boolean(starter),
        readyLessonOrder: starter?.order,
      }),
    };
  }, [plan.lessons, buildStage, buildCounts]);

  const openPractice = useCallback((lessonId: string) => goLesson(lessonId, "top"), [goLesson]);
  const generatePractice = useCallback(
    (sourceLessonId: string, concepts: GapConcept[]) => {
      void queuePractice(sourceLessonId, concepts, true);
    },
    [queuePractice],
  );

  const sidebar = (
    <aside className="hidden w-52 shrink-0 lg:block" aria-label="Course progress and outline">
      <nav className="sticky top-[72px] max-h-[calc(100dvh-6rem)] overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        <LearnProgressTrack compact {...pathFigures} />
        <NavButton onClick={goOverview} active={location.screen === "overview"} className="mb-3 font-medium">
          Course home
        </NavButton>
        <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--ink-muted)]">Lessons</p>
        <ol className="mt-2 space-y-0.5">
          {plan.lessons.map((lesson) => {
            const done = pathFigures.masteredIds.has(lesson.id);
            const markedRead = readDoneFor(progress, scope, lesson.id);
            const mastery = lessonMasteryPercent({ scope, lessonId: lesson.id, quizCount: lesson.quiz.length, progress });
            const active = location.screen === "lesson" && location.lessonId === lesson.id;
            return (
              <li key={lesson.id}>
                <NavButton onClick={() => goLesson(lesson.id)} active={active}>
                  <StepMark done={done} />
                  <span className="min-w-0 flex-1">
                    <span className="text-xs tabular-nums">{lesson.order}.</span> {lesson.title}
                    {lesson.status === "pending" ? (
                      <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">Building</span>
                    ) : null}
                    {lesson.status !== "pending" && !done && (mastery > 0 || markedRead) ? (
                      <span className="mt-0.5 block text-[10px] tabular-nums text-[var(--ink-muted)]">
                        {mastery}% mastery
                        {markedRead ? " · Marked as read" : ""}
                      </span>
                    ) : null}
                  </span>
                </NavButton>
              </li>
            );
          })}
        </ol>
        {hasFinal ? (
          <NavButton onClick={goFinal} active={location.screen === "final"} className="mt-3">
            <StepMark done={pathFigures.masteredIds.has(FINAL_LESSON_ID)} />
            <span>Final assessment</span>
          </NavButton>
        ) : null}
      </nav>
    </aside>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1120px] gap-10 overflow-x-clip px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] pt-5 sm:px-8 sm:pt-[72px] sm:pb-24">
      <div className="learn-article min-w-0 flex-1 overflow-x-clip [scrollbar-gutter:stable]">
        <LearnerStatsPanel
          variant="strip"
          pending={!stats}
          xp={stats?.xp ?? 0}
          streak={stats?.streak ?? 0}
          masteryPercent={
            activeLesson
              ? lessonMasteryPercent({ scope, lessonId: activeLesson.id, quizCount: activeLesson.quiz.length, progress })
              : null
          }
          goal={goal}
        />
        {location.screen !== "overview" ? (
          <button
            type="button"
            onClick={goOverview}
            className="mb-4 inline-flex min-h-11 max-w-full items-center gap-1 rounded-md px-1.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
          >
            <span className="shrink-0">←</span>
            <span className="truncate">{title}</span>
          </button>
        ) : null}

        {location.screen === "overview" ? (
          <>
            <p className="mb-3 inline-flex rounded-md border border-[var(--line)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
              {PROJECT_KIND_LABEL.learn}
            </p>
            <h1 className="break-words text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)] sm:text-[2.5rem]">{title}</h1>
            {buildingPlanId ? (
              <div
                className={`mt-4 overflow-hidden rounded-2xl border bg-[var(--sidebar)] ${
                  buildMilestones.starter
                    ? "study-ready border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]"
                    : "border-[var(--line)]"
                }`}
              >
                {openerSettled ? null : (
                  <OpenerQuiz key={buildingPlanId} planId={buildingPlanId} onSettled={() => setOpenerSettled(true)} />
                )}
                <PathBuildCard
                  embedded
                  quiet={!openerSettled}
                  milestones={buildMilestones.milestones}
                  lessonOneReady={Boolean(buildMilestones.starter)}
                  lessonOrder={buildMilestones.starter?.order ?? 1}
                  onStartLesson={
                    buildMilestones.starter ? () => goLesson(buildMilestones.starter!.id, "top") : undefined
                  }
                />
              </div>
            ) : null}
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
              {plan.lessons.length} lesson{plan.lessons.length === 1 ? "" : "s"} · about {roundedMin} min · {plan.complexity}{" "}
              topic
              {plan.perspective !== "neutral" ? ` · ${plan.perspective} perspective` : null}
            </p>
            <SourceNote place="home" />

            <div className="mt-5 lg:hidden">
              <LearnProgressTrack {...pathFigures} />
            </div>

            {resume ? (
              <button
                type="button"
                onClick={() => {
                  if (resume.kind === "reviews") {
                    document.getElementById("learn-review")?.scrollIntoView({ block: "start" });
                    return;
                  }
                  if (resume.kind === "final") goFinal();
                  else if (resume.kind === "lesson" || resume.kind === "gap") goLesson(resume.lessonId, "top");
                }}
                className="mt-5 flex min-h-11 w-full flex-col items-start justify-center gap-1 rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_10%,var(--sidebar))] px-4 py-3 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--line))]"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">Continue</span>
                <span className="text-sm font-medium text-[var(--ink)]">{resume.label}</span>
              </button>
            ) : null}

            <LearnReviewPanel
              plan={plan}
              scope={scope}
              progress={progress}
              timeZone={timeZone}
              gradeShort={gradeShort}
              onCommit={(updater) => commitProgress(updater, true)}
              onAward={(reason, kind) => onAwardRef.current?.(reason, kind)}
              onFocus={setReviewFocus}
            />

            {practice.cards.length ? (
              <section className="mt-8" aria-label="Practice lessons">
                <h2 className="text-base font-semibold text-[var(--ink)]">Practice</h2>
                <PracticeList cards={practice.cards} watch={gapWatch} onGenerate={generatePractice} onOpen={openPractice} />
              </section>
            ) : null}

            {plan.objectives.length ? (
              <section className="mt-10">
                <h2 className="text-base font-semibold text-[var(--ink)]">Course goals</h2>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-[var(--ink)]">
                  {plan.objectives.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {plan.prerequisites.length ? (
              <section className="mt-8">
                <h2 className="text-base font-semibold text-[var(--ink)]">Before you start</h2>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-[var(--ink)]">
                  {plan.prerequisites.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="mt-10">
              <h2 className="text-base font-semibold text-[var(--ink)]">Lessons</h2>
              <LearnPathMap
                nodes={pathFigures.nodes}
                onOpen={(nodeId) => {
                  if (nodeId === FINAL_LESSON_ID) goFinal();
                  else goLesson(nodeId);
                }}
              />
            </section>

            {showPlanNotes && plan.warnings.length ? (
              <aside className="mt-12 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-3 text-sm text-[var(--ink-muted)]">
                <p className="text-xs font-semibold uppercase tracking-[0.08em]">Plan notes</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </aside>
            ) : null}
          </>
        ) : null}

        {location.screen === "lesson" && activeLesson ? (
          <>
            {buildingPlanId && activeLesson.status !== "pending" ? (
              <p
                role="status"
                className="mb-4 rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--sidebar))] px-3 py-2 text-sm leading-relaxed text-[var(--ink)]"
              >
                You can study this lesson now. The rest of the path is still being written.
              </p>
            ) : null}
            <ReadingProgressBar
              percent={readScrollFor(progress, scope, activeLesson.id)}
              done={readDoneFor(progress, scope, activeLesson.id)}
              onMarkRead={() => commitProgress((prev) => applyRead(prev, scope, activeLesson.id, 100, true), true)}
            />
            <div id={`lesson-body-${activeLesson.id}`} className="mt-6">
              <LessonBody
                lesson={activeLesson}
                total={plan.lessons.length}
                planId={plan.id}
                articleScroll={Object.fromEntries(activeLesson.articles.map((article) => [article.url, articleScrollFor(progress, scope, article.url)]))}
                articleDone={Object.fromEntries(activeLesson.articles.map((article) => [article.url, articleDoneFor(progress, scope, article.url)]))}
                openArticleUrl={openArticleUrl}
                onArticleOpen={onArticleOpen}
                onArticleScroll={onArticleScroll}
                onArticleDone={onArticleDone}
              />
            </div>
            <QuizSection
              key={`${plan.id}:${activeLesson.id}`}
              items={activeLesson.quiz}
              heading="Check your understanding"
              saved={normalizeQuiz(lessonQuizFor(progress, scope, activeLesson.id), activeLesson.quiz.length)}
              gradeShort={gradeShort}
              onSave={(quiz) => saveQuiz(activeLesson.id, activeLesson.quiz, quiz, "lesson")}
            />
            <PracticeList
              cards={practice.cards.filter((card) => card.sourceLessonId === activeLesson.id)}
              watch={gapWatch}
              onGenerate={generatePractice}
              onOpen={openPractice}
            />
            <LessonPager
              prev={prevLesson}
              onPrev={() => prevLesson && goLesson(prevLesson.id, "top")}
              onNext={() =>
                nextLesson ? goLesson(nextLesson.id, "top") : hasFinal ? goFinal() : goOverview()
              }
              nextLabel={nextLesson ? `Lesson ${nextLesson.order}` : hasFinal ? "Final assessment" : "Course home"}
            />
          </>
        ) : null}

        {location.screen === "final" && hasFinal ? (
          <>
            <h1 className="break-words text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)] sm:text-3xl">Final assessment</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Covers the whole course.</p>
            <QuizSection
              key={`${plan.id}:final`}
              items={plan.finalAssessment}
              heading="Questions"
              saved={normalizeQuiz(finalQuizFor(progress, scope), plan.finalAssessment.length)}
              gradeShort={gradeShort}
              onSave={(quiz) => saveQuiz("final", plan.finalAssessment, quiz, "final")}
            />
            <PracticeList
              cards={practice.cards.filter((card) => practice.finalSources.has(card.sourceLessonId))}
              watch={gapWatch}
              onGenerate={generatePractice}
              onOpen={openPractice}
            />
            <LessonPager
              prev={plan.lessons[plan.lessons.length - 1]}
              onPrev={() => {
                const last = plan.lessons[plan.lessons.length - 1];
                if (last) goLesson(last.id, "top");
              }}
              onNext={goOverview}
              nextLabel="Course home"
            />
          </>
        ) : null}
      </div>
      {sidebar}
      <LearnAgentFloat projectId={projectId} plan={plan} location={location} reviewFocus={reviewFocus} />
    </div>
  );
}

function LessonPager({
  prev,
  onPrev,
  onNext,
  nextLabel,
}: {
  prev?: LearnLesson;
  onPrev: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <nav
      className="mt-12 flex flex-col items-stretch gap-3 border-t border-[var(--line)] pt-8 sm:flex-row sm:items-center sm:justify-between"
      aria-label="Lesson navigation"
    >
      {prev ? (
        <button
          type="button"
          onClick={onPrev}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] sm:justify-start"
        >
          ← Lesson {prev.order}
        </button>
      ) : (
        <span className="hidden sm:block" />
      )}
      <button
        type="button"
        onClick={onNext}
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-3 text-sm font-medium text-[var(--ink)]"
      >
        {nextLabel} →
      </button>
    </nav>
  );
}

function measureReadPercent(el: HTMLElement, lessonId: string): number {
  const scrollPct = scrollDepthPercent(el.scrollTop, el.scrollHeight, el.clientHeight);
  const root = document.getElementById(`lesson-body-${lessonId}`);
  const nodes = root ? [...root.querySelectorAll<HTMLElement>("[data-read-section]")] : [];
  const frame = el.getBoundingClientRect();
  const sections = nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  return combineReadPercent(scrollPct, sectionVisibilityPercent(sections, frame.top, frame.height), 0);
}

function useLessonScrollPersistence(
  lessonId: string | undefined,
  scope: ProgressScope,
  savedPercent: number,
  commitProgress: (updater: (prev: LearnPlanProgress) => LearnPlanProgress, immediate?: boolean) => void,
  scrollIntentRef: MutableRefObject<LessonScrollIntent>,
) {
  const commitRef = useRef(commitProgress);
  commitRef.current = commitProgress;
  const savedRef = useRef(savedPercent);
  savedRef.current = savedPercent;

  useEffect(() => {
    if (!lessonId) return;
    let cancelled = false;
    let el: HTMLElement | null = null;
    let timer: number | undefined;
    let observer: IntersectionObserver | null = null;
    let latest = 0;
    let tries = 0;

    const publish = (immediate = false) => {
      if (!el) return;
      latest = Math.max(latest, measureReadPercent(el, lessonId));
      commitRef.current((prev) => applyRead(prev, scope, lessonId, latest), immediate);
    };

    const onScroll = () => {
      if (!el) return;
      latest = Math.max(latest, measureReadPercent(el, lessonId));
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => publish(false), 120);
    };

    const start = (node: HTMLElement) => {
      el = node;
      const intent = scrollIntentRef.current;
      scrollIntentRef.current = "restore";
      const restore = () => {
        if (intent === "top") {
          node.scrollTop = 0;
          return;
        }
        const saved = latest;
        const max = node.scrollHeight - node.clientHeight;
        node.scrollTop = max > 0 ? (saved / 100) * max : 0;
      };
      requestAnimationFrame(() => {
        if (cancelled) return;
        restore();
        requestAnimationFrame(() => {
          if (cancelled) return;
          latest = Math.max(latest, measureReadPercent(node, lessonId));
          publish(latest >= 92);
        });
      });
      node.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      const sections = document.getElementById(`lesson-body-${lessonId}`)?.querySelectorAll("[data-read-section]");
      if (sections?.length && typeof IntersectionObserver !== "undefined") {
        observer = new IntersectionObserver(() => {
          if (!cancelled) publish(false);
        }, { root: node, threshold: [0, 0.25, 0.6] });
        sections.forEach((section) => observer?.observe(section));
      }
    };

    const wait = () => {
      if (cancelled) return;
      const node = mainScrollElement();
      if (!node) {
        if (tries++ < 12) requestAnimationFrame(wait);
        return;
      }
      latest = savedRef.current;
      start(node);
    };
    wait();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      observer?.disconnect();
      el?.removeEventListener("scroll", onScroll);
      if (document.getElementById(`lesson-body-${lessonId}`) && el) {
        latest = Math.max(latest, measureReadPercent(el, lessonId));
      }
      commitRef.current((prev) => applyRead(prev, scope, lessonId, latest), true);
      window.removeEventListener("resize", onScroll);
    };
  }, [lessonId, scope, scrollIntentRef]);
}

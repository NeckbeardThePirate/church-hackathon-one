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
import { gradeShortAnswerLocal, type GradeResult } from "../lib/learn/grade-answer";
import {
  XP_QUIZ_ATTEMPT,
  XP_QUIZ_CORRECT,
  XP_QUIZ_PARTIAL,
  XP_READ_LESSON,
  lessonMasteryPercent,
} from "../lib/learn/learner-stats";
import { locationForPlan, parsePathUrl, pathSearch } from "../lib/learn/path-url";
import {
  combineReadPercent,
  readPercentMarksDone,
  scrollDepthPercent,
  sectionVisibilityPercent,
} from "../lib/learn/read-progress";
import { mirrorAttemptOntoProgress, type LearnAttemptAnswer } from "../lib/learn/attempts";
import {
  countPlanProgress,
  defaultLocation,
  emptyQuiz,
  isFinalStepComplete,
  isLessonStepComplete,
  mainScrollElement,
  mergeLearnProgress,
  newConceptMastery,
  normalizeQuiz,
  quizAllAnswered,
  quizCorrectCount,
  resolveLocation,
  resumeLabel,
  retryMissedQuiz,
  writeLearnProgress,
  type LearnLocation,
  type LearnPlanProgress,
  type PersistedQuiz,
  type PersistedQuizAnswer,
} from "../lib/learn/plan-progress";
import type {
  ArticleResource,
  BookResource,
  LearnLesson,
  LearnPlan,
  QuizItem,
  LibraryCitation,
  ScriptureReading,
  TeachBlock,
  VideoResource,
} from "../lib/learn/types";
import { ArticleReadWindow } from "./ArticleReadWindow";
import { LearnAgentFloat } from "./LearnAgentFloat";
import { LearnerStatsPanel } from "./LearnerStatsPanel";
import { LessonVideoPlayer } from "./LessonVideoPlayer";
import { PROJECT_KIND_LABEL } from "../lib/projects";

type Props = {
  projectId: string;
  plan: LearnPlan;
  displayTitle?: string;
  savedProgress?: LearnPlanProgress;
  onSaveProgress?: (progress: LearnPlanProgress) => void;
  onProgress?: (progress: LearnPlanProgress) => void;
  onAward?: (reason: string, amount: number) => void;
  stats?: { xp: number; streak: number } | null;
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
      <p className="text-sm font-medium leading-snug text-[var(--ink)]">
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

function LibraryCallout({ item }: { item: LibraryCitation }) {
  const heading = item.condemned ? `${item.label} · condemned` : item.label;
  return (
    <li className="rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_90%,var(--canvas))] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
        {item.source === "confession" ? "Confession" : "Church father"}
      </p>
      <p className="mt-1 text-sm font-medium text-[var(--ink)]">
        {item.url ? <ExternalLink href={item.url}>{heading}</ExternalLink> : heading}
        {item.detail ? <span className="font-normal text-[var(--ink-muted)]"> · {item.detail}</span> : null}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">{item.text}</p>
      {item.note ? <p className="mt-2 text-sm italic text-[var(--ink-muted)]">{item.note}</p> : null}
    </li>
  );
}

function ScriptureCallout({ reading }: { reading: ScriptureReading }) {
  const gatewayUrl = bibleGatewayEsvUrl(reading.reference);
  return (
    <aside
      className="my-4 rounded-xl border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--sidebar))] px-4 py-3"
      aria-label={`Scripture: ${reading.reference}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">Berean Study Bible</p>
        <ExternalLink href={gatewayUrl}>
          <span className="break-words">{reading.reference} (ESV on Bible Gateway)</span>
        </ExternalLink>
      </div>
      <div
        className="bible-callout-body text-sm leading-relaxed text-[var(--ink)]"
        dangerouslySetInnerHTML={{ __html: esc(reading.text) }}
      />
      {reading.note ? <p className="mt-2 text-sm italic text-[var(--ink-muted)]">{reading.note}</p> : null}
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
    "w-full rounded-lg border px-3 py-2.5 text-left text-sm leading-snug transition-colors disabled:cursor-default";
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
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] disabled:opacity-70"
          />
          <button
            type="submit"
            disabled={!state.shortText.trim() || state.shortSubmitted || grading}
            className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {grading ? "Checking…" : "Check"}
          </button>
        </form>
      )}

      {item.kind === "mc" && mcAnswered ? (
        <QuizFeedback correct={mcCorrect} rationale={item.rationale} answer={mcCorrect ? undefined : item.answer} />
      ) : null}
      {item.kind === "short" && state.shortSubmitted ? (
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
  const answeredCount = quiz.answers.filter((a) => a.correct !== null).length;
  const correctCount = quizCorrectCount(quiz);
  const bestCorrect = Math.max(quiz.bestCorrect ?? 0, correctCount);
  const missed = quiz.answers.some((answer) => answer.correct === false);
  const allAnswered = quizAllAnswered(quiz);

  const updateAnswer = (index: number, answer: PersistedQuizAnswer) => {
    const next = { ...quiz, answers: [...quiz.answers] };
    next.answers[index] = answer;
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
          className="mt-4 rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)]"
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
        <span className="tabular-nums text-[var(--ink-muted)]">
          {completed}/{total}
        </span>
      </div>
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
          : "border-[var(--line)] text-transparent"
      }`}
      aria-hidden
    >
      ✓
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
  return (
    <>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        Lesson {lesson.order} of {total}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)] sm:text-3xl">{lesson.title}</h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        About {lesson.estimatedMinutes} min
        {lesson.status === "degraded" ? " · Some resources may be missing" : null}
      </p>

      {lesson.objectives.length ? (
        <div className="mt-6" data-read-section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-[var(--ink-muted)]">You will be able to</h2>
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
          <h2 className="text-base font-semibold text-[var(--ink)]">Confessions and church fathers</h2>
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

      {lesson.warnings.length ? (
        <aside className="mt-8 rounded-xl border border-[color-mix(in_srgb,var(--accent)_25%,var(--line))] bg-[color-mix(in_srgb,var(--sidebar)_80%,var(--canvas))] px-4 py-3 text-sm text-[var(--ink-muted)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em]">Notes from the plan builder</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {lesson.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </aside>
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
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              done
                ? "border-[color-mix(in_srgb,#6b9f7a_50%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_18%,var(--sidebar))] text-[color-mix(in_srgb,#6b9f7a_85%,var(--ink))]"
                : "border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] text-[var(--ink)]"
            }`}
          >
            {done ? "Read" : "Mark as read"}
          </button>
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct} percent read`}
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

function awardQuizDelta(
  projectId: string,
  lessonKey: string,
  previous: PersistedQuiz | undefined,
  next: PersistedQuiz,
  award: ((reason: string, amount: number) => void) | undefined,
) {
  if (!award) return;
  next.answers.forEach((answer, index) => {
    if (answer.correct == null && (answer.score ?? 0) < 0.4) return;
    const before = previous?.answers[index];
    if (before?.correct === true && answer.correct === true) return;
    if (before && before.correct === answer.correct && (before.score ?? null) === (answer.score ?? null)) return;
    const outcome = answer.correct ? "correct" : (answer.score ?? 0) >= 0.4 ? "partial" : "wrong";
    const amount = outcome === "correct" ? XP_QUIZ_CORRECT : outcome === "partial" ? XP_QUIZ_PARTIAL : XP_QUIZ_ATTEMPT;
    award(`quiz:${projectId}:${lessonKey}:${index}:${outcome}`, amount);
  });
}

function attemptAnswers(quiz: PersistedQuiz, items: QuizItem[]): LearnAttemptAnswer[] {
  return quiz.answers.map((answer, index) => ({
    ...(items[index]?.conceptId ? { conceptId: items[index]!.conceptId } : {}),
    ...(items[index]?.conceptLabel ? { conceptLabel: items[index]!.conceptLabel } : {}),
    mcChoice: answer.mcChoice,
    shortText: answer.shortText,
    shortSubmitted: answer.shortSubmitted,
    correct: answer.correct,
  }));
}

function paintAnswerMastery(progress: LearnPlanProgress, lessonId: string, items: QuizItem[]): LearnPlanProgress {
  const quiz = lessonId === "final" ? progress.finalQuiz : progress.lessonQuiz[lessonId];
  if (!quiz) return progress;
  let conceptMastery = progress.conceptMastery;
  let changed = false;
  const storedLesson = lessonId === "final" ? "final" : lessonId;
  items.forEach((item, index) => {
    if (!item.conceptId) return;
    const answer = quiz.answers[index];
    if (!answer || answer.correct == null) return;
    const quality = answer.correct ? 5 : (answer.score ?? 0) >= 0.4 ? 3 : 1;
    const prev =
      conceptMastery[item.conceptId] ??
      newConceptMastery({
        conceptId: item.conceptId,
        conceptLabel: item.conceptLabel || item.conceptId,
        lessonId: storedLesson,
      });
    if (prev.lastQuality === quality && prev.repetitions >= 1 && prev.lessonId === storedLesson) return;
    if (!changed) conceptMastery = { ...conceptMastery };
    changed = true;
    conceptMastery[item.conceptId] = {
      ...prev,
      conceptLabel: item.conceptLabel || prev.conceptLabel,
      lessonId: storedLesson,
      lastQuality: quality,
      lastReviewedAt: Date.now(),
      repetitions: Math.max(prev.repetitions, 1),
      correctStreak: quality >= 4 ? Math.max(1, prev.correctStreak) : 0,
    };
  });
  return changed ? { ...progress, conceptMastery } : progress;
}

function applyRead(prev: LearnPlanProgress, lessonId: string, percent: number, forceDone = false): LearnPlanProgress {
  const nextPct = Math.min(100, Math.max(prev.lessonReadScroll[lessonId] ?? 0, forceDone ? 100 : Math.round(percent)));
  const done = forceDone || readPercentMarksDone(nextPct) || prev.lessonReadDone[lessonId] === true;
  if ((prev.lessonReadScroll[lessonId] ?? 0) === nextPct && (prev.lessonReadDone[lessonId] === true) === done) return prev;
  return {
    ...prev,
    lessonReadScroll: { ...prev.lessonReadScroll, [lessonId]: nextPct },
    lessonReadDone: { ...prev.lessonReadDone, [lessonId]: done },
  };
}

export function LearnPlanView({
  projectId,
  plan,
  displayTitle,
  savedProgress,
  onSaveProgress,
  onProgress,
  onAward,
  stats,
}: Props) {
  const title = displayTitle?.trim() || plan.title.trim() || plan.topic;
  const totalMin = plan.lessons.reduce((n, l) => n + l.estimatedMinutes, 0);
  const roundedMin = Math.round(totalMin / 5) * 5;
  const hasFinal = plan.finalAssessment.length > 0;

  const hydrated = useMemo(
    () => mergeLearnProgress(savedProgress, projectId),
    [savedProgress, projectId],
  );

  const [progress, setProgress] = useState<LearnPlanProgress>(hydrated);
  const [location, setLocation] = useState<LearnLocation>(() => resolveLocation(plan.lessons, hydrated.location));

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
  const urlAppliedRef = useRef(false);

  useEffect(() => {
    onProgressRef.current?.(progressRef.current);
  }, [projectId]);

  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      onSaveProgressRef.current?.(progressRef.current);
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
      for (const [id, done] of Object.entries(next.lessonReadDone)) {
        if (done && prev.lessonReadDone[id] !== true) onAwardRef.current?.(`read:${projectId}:${id}`, XP_READ_LESSON);
      }
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (immediate) {
        saveTimerRef.current = null;
        onSaveProgressRef.current?.(next);
        return;
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        onSaveProgressRef.current?.(next);
      }, 450);
    },
    [projectId],
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
        if ((prev.articleScroll?.[url] ?? 0) === percent) return prev;
        return { ...prev, articleScroll: { ...prev.articleScroll, [url]: percent } };
      });
    },
    [commitProgress],
  );
  const onArticleDone = useCallback(
    (url: string, done: boolean) => {
      commitProgress((prev) => ({
        ...prev,
        articleDone: { ...prev.articleDone, [url]: done },
      }));
    },
    [commitProgress],
  );

  const lessonSteps = useMemo(
    () => plan.lessons.map((l) => ({ id: l.id, hasQuiz: l.quiz.length > 0 })),
    [plan.lessons],
  );
  const progressStats = useMemo(
    () => countPlanProgress(lessonSteps, hasFinal, progress),
    [lessonSteps, hasFinal, progress],
  );

  const activeLesson =
    location.screen === "lesson" && location.lessonId
      ? plan.lessons.find((l) => l.id === location.lessonId)
      : undefined;

  const lessonIndex = activeLesson ? plan.lessons.findIndex((l) => l.id === activeLesson.id) : -1;
  const prevLesson = lessonIndex > 0 ? plan.lessons[lessonIndex - 1] : undefined;
  const nextLesson = lessonIndex >= 0 && lessonIndex < plan.lessons.length - 1 ? plan.lessons[lessonIndex + 1] : undefined;

  useLessonScrollPersistence(
    activeLesson?.id,
    activeLesson ? (progress.lessonReadScroll[activeLesson.id] ?? 0) : 0,
    commitProgress,
    lessonScrollIntentRef,
  );

  useEffect(() => {
    setOpenArticleUrl(null);
  }, [activeLesson?.id]);

  const resume = resumeLabel(plan, progress, hasFinal);

  const gradeShort = useCallback((item: QuizItem, given: string) => gradeFreeText(plan.id, item, given), [plan.id]);

  const saveQuiz = useCallback(
    (lessonKey: string, items: QuizItem[], quiz: PersistedQuiz, target: "lesson" | "final") => {
      const stored = rememberQuiz(quiz);
      const previous = target === "final" ? progressRef.current.finalQuiz ?? undefined : progressRef.current.lessonQuiz[lessonKey];
      awardQuizDelta(projectId, lessonKey, previous, stored, onAwardRef.current);
      commitProgress((prev) => {
        const withQuiz =
          target === "final"
            ? { ...prev, finalQuiz: stored }
            : {
                ...prev,
                lessonQuiz: { ...prev.lessonQuiz, [lessonKey]: stored },
                lessonReadDone: stored.settled ? { ...prev.lessonReadDone, [lessonKey]: true } : prev.lessonReadDone,
              };
        return paintAnswerMastery(withQuiz, lessonKey, items);
      }, true);
      const changed = stored.answers.some((answer, index) => answer.correct !== (previous?.answers[index]?.correct ?? null));
      if (!changed) return;
      const answers = attemptAnswers(stored, items);
      if (!answers.length) return;
      void fetch(`/api/learn/plans/${plan.id}/attempts`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target,
          ...(target === "lesson" ? { lessonId: lessonKey } : {}),
          answers,
        }),
      })
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as { conceptMastery?: LearnPlanProgress["conceptMastery"] };
        })
        .then((body) => {
          if (!body?.conceptMastery) return;
          commitProgress(
            (prev) =>
              paintAnswerMastery(
                mirrorAttemptOntoProgress(
                  prev,
                  { target, ...(target === "lesson" ? { lessonId: lessonKey } : {}), answers },
                  body.conceptMastery,
                ),
                lessonKey,
                items,
              ),
            true,
          );
        })
        .catch(() => undefined);
    },
    [commitProgress, plan.id, projectId],
  );

  const sidebar = (
    <aside className="hidden w-52 shrink-0 lg:block" aria-label="Course progress and outline">
      <nav className="sticky top-[72px] max-h-[calc(100dvh-6rem)] overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        <LearnProgressTrack compact {...progressStats} />
        <NavButton onClick={goOverview} active={location.screen === "overview"} className="mb-3 font-medium">
          Course home
        </NavButton>
        <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--ink-muted)]">Lessons</p>
        <ol className="mt-2 space-y-0.5">
          {plan.lessons.map((lesson) => {
            const done = isLessonStepComplete(lesson.id, lesson.quiz.length > 0, progress);
            const readPct = progress.lessonReadScroll[lesson.id] ?? 0;
            const active = location.screen === "lesson" && location.lessonId === lesson.id;
            return (
              <li key={lesson.id}>
                <NavButton onClick={() => goLesson(lesson.id)} active={active}>
                  <StepMark done={done} />
                  <span className="min-w-0 flex-1">
                    <span className="text-xs tabular-nums">{lesson.order}.</span> {lesson.title}
                    {!done && (readPct > 0 || lessonMasteryPercent({ lessonId: lesson.id, quizCount: lesson.quiz.length, progress }) > 0) ? (
                      <span className="mt-0.5 block text-[10px] tabular-nums text-[var(--ink-muted)]">
                        {lessonMasteryPercent({ lessonId: lesson.id, quizCount: lesson.quiz.length, progress })}% mastery
                        {readPct > 0 ? ` · ${readPct}% read` : ""}
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
            <StepMark done={isFinalStepComplete(progress, true)} />
            <span>Final assessment</span>
          </NavButton>
        ) : null}
      </nav>
    </aside>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1120px] gap-10 px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] pt-14 sm:px-8 sm:pt-[72px] sm:pb-24">
      <div className="learn-article min-w-0 flex-1 [scrollbar-gutter:stable]">
        {stats ? (
          <LearnerStatsPanel
            variant="strip"
            xp={stats.xp}
            streak={stats.streak}
            masteryPercent={
              activeLesson
                ? lessonMasteryPercent({ lessonId: activeLesson.id, quizCount: activeLesson.quiz.length, progress })
                : null
            }
          />
        ) : null}
        {location.screen !== "overview" ? (
          <button
            type="button"
            onClick={goOverview}
            className="mb-4 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
          >
            ← {title}
          </button>
        ) : null}

        {location.screen === "overview" ? (
          <>
            <p className="mb-3 inline-flex rounded-md border border-[var(--line)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
              {PROJECT_KIND_LABEL.learn}
            </p>
            <h1 className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)] sm:text-[2.5rem]">{title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
              {plan.lessons.length} lesson{plan.lessons.length === 1 ? "" : "s"} · about {roundedMin} min · {plan.complexity}{" "}
              topic
              {plan.perspective !== "neutral" ? ` · ${plan.perspective} perspective` : null}
            </p>

            <div className="mt-5 lg:hidden">
              <LearnProgressTrack {...progressStats} />
            </div>

            {resume ? (
              <button
                type="button"
                onClick={() => {
                  const loc = resolveLocation(plan.lessons, progress.location);
                  if (loc.screen === "final") goFinal();
                  else if (loc.screen === "lesson" && loc.lessonId) goLesson(loc.lessonId);
                  else {
                    const next = plan.lessons.find((l) => !isLessonStepComplete(l.id, l.quiz.length > 0, progress));
                    if (next) goLesson(next.id);
                    else if (hasFinal && !isFinalStepComplete(progress, true)) goFinal();
                  }
                }}
                className="mt-5 flex w-full flex-col items-start gap-1 rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_10%,var(--sidebar))] px-4 py-3 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--line))]"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">Continue</span>
                <span className="text-sm font-medium text-[var(--ink)]">{resume}</span>
              </button>
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
              <ul className="mt-4 space-y-2">
                {plan.lessons.map((lesson) => {
                  const done = isLessonStepComplete(lesson.id, lesson.quiz.length > 0, progress);
                  const readPct = progress.lessonReadScroll[lesson.id] ?? 0;
                  const quiz = normalizeQuiz(progress.lessonQuiz[lesson.id], lesson.quiz.length);
                  const quizAnswered = lesson.quiz.length ? quiz.answers.filter((a) => a.correct !== null).length : 0;
                  return (
                    <li key={lesson.id}>
                      <button
                        type="button"
                        onClick={() => goLesson(lesson.id)}
                        className="flex w-full items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-3 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]"
                      >
                        <StepMark done={done} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-[var(--ink)]">
                            Lesson {lesson.order}: {lesson.title}
                          </span>
                          <span className="mt-1 block text-xs text-[var(--ink-muted)]">
                            {done
                              ? "Complete"
                              : readPct > 0
                                ? `${readPct}% read${lesson.quiz.length ? ` · quiz ${quizAnswered}/${lesson.quiz.length}` : ""}`
                                : `${lesson.estimatedMinutes} min${lesson.quiz.length ? ` · ${lesson.quiz.length} quiz questions` : ""}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {hasFinal ? (
              <section className="mt-8">
                <button
                  type="button"
                  onClick={goFinal}
                  className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-3 text-left hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]"
                >
                  <StepMark done={isFinalStepComplete(progress, true)} />
                  <span className="text-sm font-medium text-[var(--ink)]">Final assessment</span>
                </button>
              </section>
            ) : null}

            {plan.warnings.length ? (
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
            <ReadingProgressBar
              percent={progress.lessonReadScroll[activeLesson.id] ?? 0}
              done={progress.lessonReadDone[activeLesson.id] === true}
              onMarkRead={() => commitProgress((prev) => applyRead(prev, activeLesson.id, 100, true), true)}
            />
            <div id={`lesson-body-${activeLesson.id}`} className="mt-6">
              <LessonBody
                lesson={activeLesson}
                total={plan.lessons.length}
                planId={plan.id}
                articleScroll={progress.articleScroll ?? {}}
                articleDone={progress.articleDone ?? {}}
                openArticleUrl={openArticleUrl}
                onArticleOpen={onArticleOpen}
                onArticleScroll={onArticleScroll}
                onArticleDone={onArticleDone}
              />
            </div>
            <QuizSection
              items={activeLesson.quiz}
              heading="Check your understanding"
              saved={normalizeQuiz(progress.lessonQuiz[activeLesson.id], activeLesson.quiz.length)}
              gradeShort={gradeShort}
              onSave={(quiz) => saveQuiz(activeLesson.id, activeLesson.quiz, quiz, "lesson")}
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
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)] sm:text-3xl">Final assessment</h1>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Covers the whole course.</p>
            <QuizSection
              items={plan.finalAssessment}
              heading="Questions"
              saved={normalizeQuiz(progress.finalQuiz, plan.finalAssessment.length)}
              gradeShort={gradeShort}
              onSave={(quiz) => saveQuiz("final", plan.finalAssessment, quiz, "final")}
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
      <LearnAgentFloat projectId={projectId} plan={plan} location={location} />
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
      className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-8"
      aria-label="Lesson navigation"
    >
      {prev ? (
        <button
          type="button"
          onClick={onPrev}
          className="rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
        >
          ← Lesson {prev.order}
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext}
        className="rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-3 py-2 text-sm font-medium text-[var(--ink)]"
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
      commitRef.current((prev) => applyRead(prev, lessonId, latest), immediate);
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
      commitRef.current((prev) => applyRead(prev, lessonId, latest), true);
      window.removeEventListener("resize", onScroll);
    };
  }, [lessonId, scrollIntentRef]);
}

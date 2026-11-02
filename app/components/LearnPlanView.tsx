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
import {
  countPlanProgress,
  defaultLocation,
  emptyLearnProgress,
  emptyQuiz,
  isFinalStepComplete,
  isLessonStepComplete,
  mainScrollElement,
  mergeLearnProgress,
  normalizeQuiz,
  quizAllAnswered,
  quizCorrectCount,
  readLearnProgress,
  resolveLocation,
  resumeLabel,
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
import { LessonVideoPlayer } from "./LessonVideoPlayer";
import { PROJECT_KIND_LABEL } from "../lib/projects";

type Props = {
  projectId: string;
  plan: LearnPlan;
  displayTitle?: string;
  savedProgress?: LearnPlanProgress;
  onSaveProgress?: (progress: LearnPlanProgress) => void;
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
        if (block.type === "divider") return <hr key={i} className="my-8 border-[var(--line)]" />;
        const html = esc(block.text);
        switch (block.type) {
          case "heading1":
            return (
              <h3 key={i} className="mt-8 text-xl font-semibold tracking-[-0.02em] text-[var(--ink)]">
                {block.text}
              </h3>
            );
          case "heading2":
            return (
              <h4 key={i} className="mt-6 text-base font-semibold text-[var(--ink)]">
                {block.text}
              </h4>
            );
          case "bullet":
            return (
              <ul key={i} className="my-2 list-disc pl-6 text-[var(--ink)]">
                <li className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
              </ul>
            );
          case "numbered":
            return (
              <ol key={i} className="my-2 list-decimal pl-6 text-[var(--ink)]">
                <li className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
              </ol>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                className="my-4 border-l-2 border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] pl-4 text-[var(--ink-muted)] italic"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          default:
            return (
              <p
                key={i}
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

function shortAnswerMatches(given: string, key: string): boolean {
  const g = normAnswer(given);
  const k = normAnswer(key);
  if (!g) return false;
  if (g === k) return true;
  if (g.length >= 4 && (k.includes(g) || g.includes(k))) return true;
  return false;
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

function QuizFeedback({ correct, rationale, answer }: { correct: boolean; rationale: string; answer?: string }) {
  return (
    <div
      className={`mt-3 rounded-lg border px-3 py-2.5 text-sm leading-relaxed ${
        correct
          ? "border-[color-mix(in_srgb,#6b9f7a_40%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_8%,var(--canvas))] text-[var(--ink)]"
          : "border-[color-mix(in_srgb,#c97a7a_40%,var(--line))] bg-[color-mix(in_srgb,#c97a7a_8%,var(--canvas))] text-[var(--ink)]"
      }`}
      role="status"
    >
      <p className="font-medium">{correct ? "Correct" : "Not quite"}</p>
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
}: {
  item: QuizItem;
  index: number;
  state: PersistedQuizAnswer;
  onChange: (next: PersistedQuizAnswer) => void;
}) {
  const mcAnswered = state.mcChoice !== null;
  const mcCorrect = state.correct === true;
  const shortCorrect = state.shortSubmitted && state.correct === true;

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
    if (state.shortSubmitted || !state.shortText.trim()) return;
    onChange({
      ...state,
      shortSubmitted: true,
      correct: shortAnswerMatches(state.shortText, item.answer),
    });
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
            disabled={state.shortSubmitted}
            placeholder="Type your answer"
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] disabled:opacity-70"
          />
          <button
            type="submit"
            disabled={!state.shortText.trim() || state.shortSubmitted}
            className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Check
          </button>
        </form>
      )}

      {item.kind === "mc" && mcAnswered ? (
        <QuizFeedback correct={mcCorrect} rationale={item.rationale} answer={mcCorrect ? undefined : item.answer} />
      ) : null}
      {item.kind === "short" && state.shortSubmitted ? (
        <QuizFeedback correct={shortCorrect} rationale={item.rationale} answer={shortCorrect ? undefined : item.answer} />
      ) : null}
    </li>
  );
}

function QuizSection({
  items,
  heading,
  saved,
  onSave,
}: {
  items: QuizItem[];
  heading: string;
  saved: PersistedQuiz;
  onSave: (quiz: PersistedQuiz) => void;
}) {
  const quiz = normalizeQuiz(saved, items.length);
  const answeredCount = quiz.answers.filter((a) => a.correct !== null).length;
  const correctCount = quizCorrectCount(quiz);
  const allAnswered = quizAllAnswered(quiz);

  const updateAnswer = (index: number, answer: PersistedQuizAnswer) => {
    const next = { answers: [...quiz.answers] };
    next.answers[index] = answer;
    onSave(next);
  };

  const reset = () => onSave(emptyQuiz(items.length));

  if (!items.length) return null;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-base font-semibold text-[var(--ink)]">{heading}</h4>
        {answeredCount > 0 ? (
          <p className="text-xs tabular-nums text-[var(--ink-muted)]">
            {correctCount}/{answeredCount} correct
            {allAnswered ? ` · ${correctCount}/${items.length} total` : ""}
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
          />
        ))}
      </ol>
      {answeredCount > 0 ? (
        <button
          type="button"
          onClick={reset}
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
        <div className="mt-6">
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
        <div className="mt-8">
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
        <div className="mt-8">
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
        <div className="mt-8">
          <h2 className="text-base font-semibold text-[var(--ink)]">Books</h2>
          <ul className="mt-3 space-y-2">
            {lesson.books.map((b) => (
              <ResourceCard key={b.url} href={b.url} title={b.title} meta={bookMeta(b)} review={b.review} />
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.library?.length ? (
        <div className="mt-8">
          <h2 className="text-base font-semibold text-[var(--ink)]">Confessions and church fathers</h2>
          <ul className="mt-3 space-y-3">
            {lesson.library.map((item) => (
              <LibraryCallout key={`${item.source}-${item.id}`} item={item} />
            ))}
          </ul>
        </div>
      ) : null}

      {lesson.scripture.length ? (
        <div className="mt-8">
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

function ReadingProgressBar({ percent }: { percent: number }) {
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">Reading</span>
        <span className="tabular-nums text-[var(--ink-muted)]">{pct}%</span>
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

export function LearnPlanView({ projectId, plan, displayTitle, savedProgress, onSaveProgress }: Props) {
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
  const onSaveProgressRef = useRef(onSaveProgress);
  onSaveProgressRef.current = onSaveProgress;

  useEffect(() => {
    const next = mergeLearnProgress(savedProgress, projectId);
    setProgress(next);
    setLocation(resolveLocation(plan.lessons, next.location));
  }, [projectId, savedProgress, plan.lessons]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const commitProgress = useCallback(
    (updater: (prev: LearnPlanProgress) => LearnPlanProgress) => {
      setProgress((prev) => {
        const next = updater(prev);
        writeLearnProgress(projectId, next);
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          onSaveProgressRef.current?.(next);
        }, 450);
        return next;
      });
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

  useLessonScrollPersistence(activeLesson?.id, progress, commitProgress, lessonScrollIntentRef);

  useEffect(() => {
    setOpenArticleUrl(null);
  }, [activeLesson?.id]);

  const resume = resumeLabel(plan, progress, hasFinal);

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
                    {!done && readPct > 0 ? (
                      <span className="mt-0.5 block text-[10px] tabular-nums text-[var(--ink-muted)]">{readPct}% read</span>
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
            <ReadingProgressBar percent={progress.lessonReadScroll[activeLesson.id] ?? 0} />
            <div className="mt-6">
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
              onSave={(quiz) =>
                commitProgress((prev) => ({
                  ...prev,
                  lessonQuiz: { ...prev.lessonQuiz, [activeLesson.id]: quiz },
                  lessonReadDone: quizAllAnswered(quiz)
                    ? { ...prev.lessonReadDone, [activeLesson.id]: true }
                    : prev.lessonReadDone,
                }))
              }
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
              onSave={(quiz) => commitProgress((prev) => ({ ...prev, finalQuiz: quiz }))}
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

function useLessonScrollPersistence(
  lessonId: string | undefined,
  progress: LearnPlanProgress,
  commitProgress: (updater: (prev: LearnPlanProgress) => LearnPlanProgress) => void,
  scrollIntentRef: MutableRefObject<LessonScrollIntent>,
) {
  useEffect(() => {
    if (!lessonId) return;
    const el = mainScrollElement();
    if (!el) return;

    const intent = scrollIntentRef.current;
    scrollIntentRef.current = "restore";

    const pct = progress.lessonReadScroll[lessonId] ?? 0;
    const applyScroll = () => {
      if (intent === "top") {
        el.scrollTop = 0;
        return;
      }
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = max > 0 ? (pct / 100) * max : 0;
    };
    requestAnimationFrame(() => requestAnimationFrame(applyScroll));

    let timer: number | undefined;
    const onScroll = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const max = el.scrollHeight - el.clientHeight;
        const nextPct = max <= 0 ? 100 : Math.min(100, Math.round((el.scrollTop / max) * 100));
        commitProgress((prev) => {
          const readDone = nextPct >= 90 || prev.lessonReadDone[lessonId] === true;
          return {
            ...prev,
            lessonReadScroll: { ...prev.lessonReadScroll, [lessonId]: nextPct },
            lessonReadDone: readDone ? { ...prev.lessonReadDone, [lessonId]: true } : prev.lessonReadDone,
          };
        });
      }, 150);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer) window.clearTimeout(timer);
    };
  }, [lessonId, commitProgress]);
}

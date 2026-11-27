"use client";

import { useEffect, useId, useRef, useState } from "react";
import { bibleGatewayEsvUrl } from "../lib/bible/bible-gateway";
import {
  GUEST_HONESTY_COPY,
  GUEST_OPEN_LESSON_ID,
  GUEST_PATH_TITLE,
  GUEST_SAMPLE_CHECK_XP,
  GUEST_SAMPLE_GAP_ID,
  GUEST_SAMPLE_QUESTION,
  guestChoiceVisual,
  guestHighlightId,
  guestLesson,
  guestPathNodes,
  guestSampleFeedback,
  guestSampleHeading,
  guestSamplePhase,
  initialGuestSample,
  pickGuestSample,
  revealGuestMiss,
  type GuestCitation,
  type GuestLessonPreview,
  type GuestSampleState,
} from "../lib/learn/guest-preview";
import { LearnPathMap } from "./LearnPathMap";
import { LegalLinks } from "./LegalLinks";

const serif = { fontFamily: "var(--font-serif), Georgia, 'Iowan Old Style', serif" } as const;

const ctaClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 text-center text-sm font-medium text-[#1c1a16] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_88%,white)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:w-auto sm:text-base";

const quietCtaClass =
  "mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2.5 text-center text-sm font-medium text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:bg-[var(--sidebar-active)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:w-auto";

const textLinkClass =
  "inline-flex min-h-11 items-center text-left text-sm font-medium text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] underline decoration-[color-mix(in_srgb,var(--accent)_40%,transparent)] underline-offset-[3px] hover:decoration-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

const quietLinkClass =
  "inline-flex min-h-11 items-center text-left text-sm text-[var(--ink-muted)] underline-offset-[3px] hover:text-[var(--ink)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

type ScrollIntent = "panel" | "gap-node" | "check";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isDesktopPath(): boolean {
  return window.matchMedia("(min-width: 1024px)").matches;
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

function SignInLink({ className }: { className: string }) {
  return (
    <a href="/sign-in" className={className}>
      Sign in to build your own path
    </a>
  );
}

function CitationList({ citations }: { citations: readonly GuestCitation[] }) {
  return (
    <ul className="mt-5 space-y-3">
      {citations.map((item) =>
        item.kind === "scripture" ? (
          <li key={`scripture-${item.reference}`}>
            <ScriptureCitation item={item} />
          </li>
        ) : (
          <li key={`confession-${item.detail}`}>
            <ConfessionCitation item={item} />
          </li>
        ),
      )}
    </ul>
  );
}

function ScriptureCitation({ item }: { item: Extract<GuestCitation, { kind: "scripture" }> }) {
  return (
    <aside
      className="rounded-xl border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--sidebar))] px-4 py-3"
      aria-label={`Scripture: ${item.reference}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">Scripture · retrieved</p>
        <a
          href={bibleGatewayEsvUrl(item.reference)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] underline-offset-2 hover:underline"
        >
          <span className="break-words">{item.reference} on Bible Gateway</span>
        </a>
      </div>
      <p className="text-sm leading-relaxed text-[var(--ink)]">{item.text}</p>
      <p className="mt-2 text-sm italic text-[var(--ink-muted)]">{item.note}</p>
    </aside>
  );
}

function ConfessionCitation({ item }: { item: Extract<GuestCitation, { kind: "confession" }> }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--sidebar)_90%,var(--canvas))] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">Confession · retrieved</p>
      <p className="mt-1 text-sm font-medium text-[var(--ink)]">
        {item.label}
        <span className="font-normal text-[var(--ink-muted)]"> · {item.detail}</span>
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">{item.text}</p>
      <p className="mt-2 text-sm italic text-[var(--ink-muted)]">{item.note}</p>
    </div>
  );
}

function ReviewChip({ review, xp }: { review: string; xp: string }) {
  return (
    <p
      className="mt-4 flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-3 py-1.5 text-xs"
      data-guest-chip
      aria-label={`${review}, ${xp}`}
    >
      <span className="text-[var(--ink-muted)]">{review}</span>
      <span aria-hidden="true" className="text-[var(--line)]">
        ·
      </span>
      <span className="font-semibold tabular-nums text-[var(--ink)]">{xp}</span>
    </p>
  );
}

function sampleChoiceClass(visual: "idle" | "correct" | "wrong"): string {
  const base =
    "flex min-h-11 w-full items-center rounded-lg border px-3 py-2.5 text-left text-sm leading-snug break-words transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-default";
  switch (visual) {
    case "correct":
      return `${base} border-[color-mix(in_srgb,#6b9f7a_55%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_14%,var(--sidebar))] text-[var(--ink)]`;
    case "wrong":
      return `${base} border-[color-mix(in_srgb,#c97a7a_55%,var(--line))] bg-[color-mix(in_srgb,#c97a7a_12%,var(--sidebar))] text-[var(--ink)]`;
    default:
      return `${base} border-[var(--line)] bg-[var(--sidebar)] text-[var(--ink)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] enabled:hover:bg-[color-mix(in_srgb,var(--accent)_6%,var(--sidebar))]`;
  }
}

function SampleCheck({
  sample,
  onPick,
  onRevealMiss,
  onReset,
}: {
  sample: GuestSampleState;
  onPick: (choiceId: string) => void;
  onRevealMiss: () => void;
  onReset: () => void;
}) {
  const heading = guestSampleHeading(sample);
  const feedback = guestSampleFeedback(sample);
  const tone =
    sample.correct === true
      ? "border-[color-mix(in_srgb,#6b9f7a_40%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_8%,var(--canvas))]"
      : sample.correct === false
        ? "border-[color-mix(in_srgb,#c97a7a_40%,var(--line))] bg-[color-mix(in_srgb,#c97a7a_8%,var(--canvas))]"
        : "border-[color-mix(in_srgb,var(--accent)_40%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--canvas))]";
  const answered = sample.pickedId !== null || sample.gapSpawned;

  return (
    <section
      id="guest-quick-check"
      tabIndex={-1}
      data-guest-check
      data-guest-phase={guestSamplePhase(sample)}
      aria-labelledby="guest-quick-check-title"
      className="mt-5 scroll-mt-4 rounded-xl border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--canvas)_35%,var(--sidebar))] px-4 py-4 outline-none"
    >
      <h3 id="guest-quick-check-title" className="text-base font-semibold tracking-[-0.01em] text-[var(--ink)]">
        Try a quick check
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">One question from this lesson. It stays in the browser.</p>
      <p className="mt-3 text-sm font-medium leading-relaxed text-[var(--ink)]">{GUEST_SAMPLE_QUESTION.prompt}</p>
      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">Choose one answer</legend>
        {GUEST_SAMPLE_QUESTION.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            data-guest-choice={choice.id}
            aria-pressed={sample.pickedId === choice.id}
            aria-disabled={sample.pickedId !== null || undefined}
            onClick={() => onPick(choice.id)}
            className={sampleChoiceClass(guestChoiceVisual(sample, choice.id))}
          >
            {choice.label}
          </button>
        ))}
      </fieldset>
      {heading && feedback ? (
        <div role="status" data-guest-feedback className={`mt-3 rounded-lg border px-3 py-2.5 text-sm leading-relaxed break-words text-[var(--ink)] ${tone}`}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="font-medium">{heading}</p>
            {sample.correct === true ? (
              <p
                key={sample.awardTick}
                data-guest-xp-chip
                className="guest-xp-pop inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-3 py-1.5 text-xs"
                aria-label={`Sample award, plus ${GUEST_SAMPLE_CHECK_XP} XP`}
              >
                <span className="text-[var(--ink-muted)]">Sample</span>
                <span aria-hidden="true" className="text-[var(--line)]">
                  ·
                </span>
                <span className="font-semibold tabular-nums text-[var(--ink)]">+{GUEST_SAMPLE_CHECK_XP} XP</span>
              </p>
            ) : null}
          </div>
          <p className="mt-1 text-[var(--ink-muted)]">{feedback}</p>
          {sample.correct === true && sample.gapSpawned ? (
            <p className="mt-2 text-[var(--ink-muted)]">The practice step is on the path as well.</p>
          ) : null}
        </div>
      ) : null}
      {sample.gapSpawned ? null : (
        <button type="button" onClick={onRevealMiss} data-guest-miss className={`${quietLinkClass} mt-3 flex w-fit`}>
          See what happens when you miss
        </button>
      )}
      {answered ? (
        <button type="button" onClick={onReset} data-guest-reset className={`${textLinkClass} mt-1 flex w-fit`}>
          Reset sample
        </button>
      ) : null}
    </section>
  );
}

function LessonPanel({
  lesson,
  titleId,
  sample,
  onClose,
  onPick,
  onRevealMiss,
  onReset,
}: {
  lesson: GuestLessonPreview;
  titleId: string;
  sample: GuestSampleState;
  onClose: () => void;
  onPick: (choiceId: string) => void;
  onRevealMiss: () => void;
  onReset: () => void;
}) {
  const showCheck = lesson.id === GUEST_SAMPLE_QUESTION.lessonId;
  const showGapReset = lesson.id === GUEST_SAMPLE_GAP_ID;
  return (
    <article aria-labelledby={titleId} data-guest-lesson={lesson.id} data-guest-gap={showGapReset ? "open" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">{lesson.kicker}</p>
          <h2 id={titleId} tabIndex={-1} className="mt-1 text-xl font-semibold tracking-[-0.02em] text-[var(--ink)] outline-none">
            {lesson.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-sm text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Close
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--ink-muted)]">Read-only preview. Nothing you open here is saved.</p>
      {showCheck ? <SampleCheck sample={sample} onPick={onPick} onRevealMiss={onRevealMiss} onReset={onReset} /> : null}
      {showGapReset ? (
        <>
          <p className="mt-4 text-sm leading-relaxed text-[var(--ink-muted)]" data-guest-honesty>
            {GUEST_HONESTY_COPY}
          </p>
          <CitationList citations={lesson.citations} />
          <button type="button" onClick={onReset} data-guest-reset className={`${textLinkClass} mt-4 flex w-fit`}>
            Reset sample
          </button>
        </>
      ) : null}
      <ReviewChip review={lesson.review} xp={lesson.xp} />
      <div className="mt-4 space-y-3">
        {lesson.excerpt.map((paragraph) => (
          <p key={paragraph.slice(0, 24)} className="text-[15px] leading-relaxed text-[var(--ink)]">
            {paragraph}
          </p>
        ))}
      </div>
      {showGapReset ? null : (
        <>
          <p className="mt-5 text-sm leading-relaxed text-[var(--ink-muted)]" data-guest-honesty>
            {GUEST_HONESTY_COPY}
          </p>
          <CitationList citations={lesson.citations} />
        </>
      )}
      <SignInLink className={quietCtaClass} />
    </article>
  );
}

function EmptyPanel({ titleId, onCheck }: { titleId: string; onCheck: () => void }) {
  return (
    <div className="py-2">
      <h2 id={titleId} tabIndex={-1} className="text-base font-semibold text-[var(--ink)] outline-none">
        Choose a step
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
        Open a completed lesson, the current lesson, or Practice lesson ready. Locked steps stay closed until that work is done.
      </p>
      <button type="button" onClick={onCheck} className={`${textLinkClass} mt-3`}>
        Try a quick check
      </button>
    </div>
  );
}

export function GuestPreview() {
  const [selectedId, setSelectedId] = useState<string | null>(GUEST_OPEN_LESSON_ID);
  const [sample, setSample] = useState<GuestSampleState>(initialGuestSample);
  const panelRef = useRef<HTMLDivElement>(null);
  const intent = useRef<ScrollIntent | null>(null);
  const titleId = useId();
  const lesson = selectedId ? guestLesson(selectedId) : null;
  const nodes = guestPathNodes(sample);

  useEffect(() => {
    const action = intent.current;
    if (!action) return;
    intent.current = null;
    const desktop = isDesktopPath();
    const behavior = scrollBehavior();

    if (action === "check") {
      const check = document.getElementById("guest-quick-check");
      if (check instanceof HTMLElement) {
        if (!desktop) check.scrollIntoView({ block: "start", behavior });
        check.focus({ preventScroll: true });
      }
      return;
    }

    if (action === "gap-node" && !desktop) {
      const node = document.querySelector(`[data-path-node="${GUEST_SAMPLE_GAP_ID}"]`);
      if (node instanceof HTMLElement) {
        node.scrollIntoView({ block: "start", behavior });
        node.focus({ preventScroll: true });
      }
      return;
    }

    if (!desktop) panelRef.current?.scrollIntoView({ block: "start", behavior });
    const heading = panelRef.current?.querySelector("h2");
    if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  function openNode(id: string) {
    intent.current = id === GUEST_SAMPLE_GAP_ID ? "gap-node" : "panel";
    setSelectedId(id);
  }

  function openCheck() {
    if (selectedId !== GUEST_SAMPLE_QUESTION.lessonId) {
      intent.current = "check";
      setSelectedId(GUEST_SAMPLE_QUESTION.lessonId);
      return;
    }
    const check = document.getElementById("guest-quick-check");
    if (!(check instanceof HTMLElement)) return;
    if (!isDesktopPath()) check.scrollIntoView({ block: "start", behavior: scrollBehavior() });
    check.focus({ preventScroll: true });
  }

  function onPick(choiceId: string) {
    const next = pickGuestSample(sample, choiceId);
    if (next === sample) return;
    setSample(next);
    if (next.gapSpawned && !sample.gapSpawned) {
      intent.current = "gap-node";
      setSelectedId(GUEST_SAMPLE_GAP_ID);
    }
  }

  function onRevealMiss() {
    const next = revealGuestMiss(sample);
    if (next === sample) return;
    setSample(next);
    intent.current = "gap-node";
    setSelectedId(GUEST_SAMPLE_GAP_ID);
  }

  function onReset() {
    setSample(initialGuestSample());
    if (selectedId !== GUEST_OPEN_LESSON_ID) {
      intent.current = "check";
      setSelectedId(GUEST_OPEN_LESSON_ID);
    }
  }

  return (
    <div data-guest-landing className="safe-area-x flex h-dvh flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <header className="safe-area-top shrink-0 border-b border-[var(--line)] bg-[var(--sidebar)]">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
            <a href="/" className="text-lg tracking-[-0.02em] text-[var(--ink)]" style={serif}>
              StudyBuddy
            </a>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)] sm:mt-0.5">Guest preview</p>
          </div>
          <SignInLink className={ctaClass} />
        </div>
      </header>
      <main className="safe-area-bottom min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ink-muted)]" aria-label="Sample learner stats">
            <span className="font-medium uppercase tracking-[0.08em]">Sample</span>
            <span>
              XP{" "}
              <strong
                key={sample.awardTick}
                data-guest-xp={sample.xp}
                className={`inline-block tabular-nums font-semibold text-[var(--ink)]${sample.awardTick > 0 ? " guest-xp-pop" : ""}`}
              >
                {sample.xp}
              </strong>
            </span>
            <span>
              Streak <strong className="tabular-nums font-semibold text-[var(--ink)]">4</strong> days
            </span>
          </p>
          <p className="mt-6 text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">Sample path</p>
          <h1 className="mt-2 text-4xl leading-[1.12] tracking-[-0.02em] text-[var(--ink)] sm:text-5xl" style={serif}>
            {GUEST_PATH_TITLE}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-relaxed text-[var(--ink-muted)]">
            <span className="whitespace-nowrap">5 lessons</span>
            <span className="whitespace-nowrap">· {sample.gapSpawned ? "two practice steps" : "one practice step"}</span>
            <span className="whitespace-nowrap">· about 2 hours</span>
            <span className="whitespace-nowrap">· Reformed</span>
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--ink)]">
            A read-only look at a StudyBuddy path. Open a lesson for the excerpt, the sources, and a spaced-review chip. The
            lesson in progress includes a quick check. This copy is bundled so you can look around with no account. On your own
            path, Scripture and the confessions are retrieved from the library.
          </p>
          <button type="button" onClick={openCheck} className={`${textLinkClass} mt-3 lg:hidden`}>
            Try a quick check
          </button>

          <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-10">
            <section aria-label="Sample path map" className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--ink)]">Path</h2>
              <LearnPathMap nodes={nodes} highlightId={guestHighlightId(sample)} onOpen={openNode} />
            </section>
            <section
              ref={panelRef}
              id="guest-preview-panel"
              aria-live="polite"
              data-guest-panel
              className="min-w-0 scroll-mt-4 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-4 sm:px-5 sm:py-5"
            >
              {lesson ? (
                <LessonPanel
                  lesson={lesson}
                  titleId={titleId}
                  sample={sample}
                  onClose={() => setSelectedId(null)}
                  onPick={onPick}
                  onRevealMiss={onRevealMiss}
                  onReset={onReset}
                />
              ) : (
                <EmptyPanel titleId={titleId} onCheck={openCheck} />
              )}
            </section>
          </div>
          <footer className="mt-12 border-t border-[var(--line)] pt-4">
            <LegalLinks />
          </footer>
        </div>
      </main>
    </div>
  );
}

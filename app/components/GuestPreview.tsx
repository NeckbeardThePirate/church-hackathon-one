"use client";

import { useEffect, useId, useRef, useState } from "react";
import { bibleGatewayEsvUrl } from "../lib/bible/bible-gateway";
import {
  GUEST_HONESTY_COPY,
  GUEST_OPEN_LESSON_ID,
  GUEST_PATH_NODES,
  GUEST_PATH_TITLE,
  guestLesson,
  type GuestCitation,
  type GuestLessonPreview,
} from "../lib/learn/guest-preview";
import { LearnPathMap } from "./LearnPathMap";

const serif = { fontFamily: "var(--font-serif), Georgia, 'Iowan Old Style', serif" } as const;

const ctaClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 text-center text-sm font-medium text-[#1c1a16] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_88%,white)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:w-auto sm:text-base";

const quietCtaClass =
  "mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2.5 text-center text-sm font-medium text-[var(--ink)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:bg-[var(--sidebar-active)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:w-auto";

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
      className="mt-4 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-3 py-1.5 text-xs"
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

function LessonPanel({
  lesson,
  titleId,
  onClose,
}: {
  lesson: GuestLessonPreview;
  titleId: string;
  onClose: () => void;
}) {
  return (
    <article aria-labelledby={titleId}>
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
      <ReviewChip review={lesson.review} xp={lesson.xp} />
      <div className="mt-4 space-y-3">
        {lesson.excerpt.map((paragraph) => (
          <p key={paragraph.slice(0, 24)} className="text-[15px] leading-relaxed text-[var(--ink)]">
            {paragraph}
          </p>
        ))}
      </div>
      <p className="mt-5 text-sm leading-relaxed text-[var(--ink-muted)]" data-guest-honesty>
        {GUEST_HONESTY_COPY}
      </p>
      <CitationList citations={lesson.citations} />
      <SignInLink className={quietCtaClass} />
    </article>
  );
}

function EmptyPanel() {
  return (
    <div className="py-2">
      <h2 className="text-base font-semibold text-[var(--ink)]">Choose a step</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
        Open a completed lesson, the current lesson, or Practice lesson ready. Locked steps stay closed until that work is done.
      </p>
    </div>
  );
}

export function GuestPreview() {
  const [selectedId, setSelectedId] = useState<string | null>(GUEST_OPEN_LESSON_ID);
  const panelRef = useRef<HTMLDivElement>(null);
  const fromClick = useRef(false);
  const titleId = useId();
  const lesson = selectedId ? guestLesson(selectedId) : null;

  useEffect(() => {
    if (!fromClick.current) return;
    fromClick.current = false;
    const panel = panelRef.current;
    if (!panel) return;
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      panel.scrollIntoView({ block: "start" });
    }
    const heading = panel.querySelector("h2");
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
              XP <strong className="tabular-nums font-semibold text-[var(--ink)]">60</strong>
            </span>
            <span>
              Streak <strong className="tabular-nums font-semibold text-[var(--ink)]">4</strong> days
            </span>
          </p>
          <p className="mt-6 text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">Sample path</p>
          <h1 className="mt-2 text-4xl leading-[1.12] tracking-[-0.02em] text-[var(--ink)] sm:text-5xl" style={serif}>
            {GUEST_PATH_TITLE}
          </h1>
          <p className="mt-3 text-balance text-sm leading-relaxed text-[var(--ink-muted)]">
            5 lessons · one practice step · about 2 hours · Reformed
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--ink)]">
            A read-only look at a StudyBuddy path. Open a lesson for the excerpt, the sources, and a spaced-review chip. This
            copy is bundled so you can look around with no account. On your own path, Scripture and the confessions are retrieved
            from the library.
          </p>

          <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-10">
            <section aria-label="Sample path map" className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--ink)]">Path</h2>
              <LearnPathMap
                nodes={[...GUEST_PATH_NODES]}
                onOpen={(id) => {
                  fromClick.current = true;
                  setSelectedId(id);
                }}
              />
            </section>
            <section
              ref={panelRef}
              id="guest-preview-panel"
              aria-live="polite"
              data-guest-panel
              className="min-w-0 scroll-mt-4 rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 py-4 sm:px-5 sm:py-5"
            >
              {lesson ? (
                <LessonPanel lesson={lesson} titleId={titleId} onClose={() => setSelectedId(null)} />
              ) : (
                <EmptyPanel />
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

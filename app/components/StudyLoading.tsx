"use client";

import { useEffect, useState } from "react";
import { StudyLamp, StudyShimmer } from "./StudyLamp";

const LINES = ["Lighting the lamp…", "Opening the study…", "Finding your place…"];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return reduced;
}

type ScreenProps = {
  title: string;
  caption?: string;
};

/** Full-viewport wait for auth and the workspace. */
export function StudyLoading({ title, caption }: ScreenProps) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (caption || reduced) return;
    const timer = window.setInterval(() => setIndex((value) => value + 1), 2800);
    return () => window.clearInterval(timer);
  }, [caption, reduced]);
  const line = caption ?? LINES[index % LINES.length];

  return (
    <div
      className="safe-area-x flex min-h-dvh flex-col items-center justify-center bg-[var(--canvas)] px-6 text-center"
      role="status"
      aria-live="polite"
    >
      <StudyLamp size={76} live />
      <div className="study-rise mt-6 max-w-sm">
        <p className="study-serif text-2xl italic leading-snug text-[var(--ink)]">{title}</p>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">{line}</p>
      </div>
      <div className="mt-8 flex w-44 flex-col items-center gap-2">
        <StudyShimmer className="h-1.5 w-full" />
        <StudyShimmer className="h-1.5 w-4/5" />
        <StudyShimmer className="h-1.5 w-3/5" />
      </div>
    </div>
  );
}

type PlaceholderProps = {
  kicker: string;
  title: string;
  caption: string;
};

/** In-flow wait while a lesson or article is still being gathered. */
export function StudyPlaceholder({ kicker, title, caption }: PlaceholderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="study-rise overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[var(--sidebar)] px-4 py-5"
    >
      <StudyLamp size={52} live />
      <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">{kicker}</p>
      <h1 className="study-serif mt-2 break-words text-2xl italic leading-snug text-[var(--ink)]">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{caption}</p>
      <div className="mt-6 space-y-2.5">
        <StudyShimmer className="h-3 w-full" />
        <StudyShimmer className="h-3 w-11/12" />
        <StudyShimmer className="h-3 w-4/5" />
        <StudyShimmer className="mt-4 h-3 w-2/3" />
        <StudyShimmer className="h-3 w-1/2" />
      </div>
    </div>
  );
}

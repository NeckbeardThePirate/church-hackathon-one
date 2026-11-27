"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MilestoneId, MilestoneState, PathMilestone } from "../lib/learn/path-milestones";

type Props = {
  milestones: PathMilestone[];
  lessonOneReady: boolean;
  lessonOrder?: number;
  onStartLesson?: () => void;
  /** The building screen supplies its own frame and the live status underneath. */
  embedded?: boolean;
};

const SHORT: Record<MilestoneId, string> = {
  outline: "Outline",
  library: "Library",
  "lesson-1": "Lesson 1",
  rest: "Remaining",
};

/** How far the light has traveled while each beat is the one in progress. */
const REACH = [0.18, 0.42, 0.68, 0.9] as const;

/**
 * One rising stroke. The unlit road and the illuminated ribbon share it,
 * so the head of the light and the drawn stroke stay on the same curve.
 */
const GUIDE = "M 36 132 C 156 140, 228 86, 320 70 C 430 50, 512 46, 604 60";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lightProgress(milestones: PathMilestone[]): number {
  if (milestones.length === 0) return 0.12;
  if (milestones.every((step) => step.state === "done")) return 1;
  const active = milestones.findIndex((step) => step.state === "active");
  if (active >= 0) return REACH[Math.min(active, REACH.length - 1)] ?? 0.18;
  const done = milestones.filter((step) => step.state === "done").length;
  return REACH[Math.min(done, REACH.length - 1)] ?? 0.18;
}

function usePrefersReducedMotion(): boolean {
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

function setCircle(node: SVGCircleElement | null, x: number, y: number, opacity: number) {
  if (!node) return;
  node.setAttribute("cx", x.toFixed(1));
  node.setAttribute("cy", y.toFixed(1));
  node.setAttribute("opacity", opacity.toFixed(3));
}

function segmentClass(state: MilestoneState): string {
  if (state === "done") return "bg-[var(--accent)]";
  if (state === "active") return "path-stage-live bg-[linear-gradient(90deg,var(--accent),#e7c56a)]";
  return "bg-[color-mix(in_srgb,var(--accent)_22%,var(--line))]";
}

function labelClass(state: MilestoneState): string {
  if (state === "active") return "font-medium text-[var(--ink)]";
  if (state === "done") return "text-[color-mix(in_srgb,var(--ink)_72%,var(--ink-muted))]";
  return "text-[var(--ink-muted)]";
}

/** Illuminated arc for a path that is still being written. Decorative; the words carry the facts. */
function PathSwoosh({ progress }: { progress: number }) {
  const reduced = usePrefersReducedMotion();
  const rawId = useId().replace(/:/g, "");
  const goldId = `path-swoosh-gold-${rawId}`;
  const haloId = `path-swoosh-halo-${rawId}`;
  const guideRef = useRef<SVGPathElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const tailARef = useRef<SVGCircleElement>(null);
  const tailBRef = useRef<SVGCircleElement>(null);
  const headRef = useRef<SVGCircleElement>(null);
  const shown = useRef(progress);
  const hidden = 100 - progress * 100;

  useEffect(() => {
    const path = guideRef.current;
    if (!path) return;
    const length = path.getTotalLength();
    if (!length) return;

    const pointAt = (t: number) => path.getPointAtLength(length * clamp(t, 0.02, 0.985));

    const place = (t: number, drift: number) => {
      const head = pointAt(t + drift);
      setCircle(haloRef.current, head.x, head.y, reduced ? 0.75 : 1);
      setCircle(headRef.current, head.x, head.y, 1);
      if (reduced) {
        setCircle(tailARef.current, head.x, head.y, 0);
        setCircle(tailBRef.current, head.x, head.y, 0);
        return;
      }
      const tailA = pointAt(t + drift - 0.03);
      const tailB = pointAt(t + drift - 0.058);
      setCircle(tailARef.current, tailA.x, tailA.y, 0.5);
      setCircle(tailBRef.current, tailB.x, tailB.y, 0.2);
    };

    if (reduced) {
      shown.current = progress;
      place(progress, 0);
      return;
    }

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      shown.current += (progress - shown.current) * (1 - Math.exp(-dt * 2.1));
      const catchingUp = Math.min(1, Math.abs(progress - shown.current) * 12);
      const drift = Math.sin(now / 1100) * 0.009 * (1 - catchingUp);
      place(shown.current, drift);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress, reduced]);

  return (
    <svg viewBox="0 0 640 188" className="relative block h-auto w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={goldId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b89a62" />
          <stop offset="48%" stopColor="#e0c27a" />
          <stop offset="100%" stopColor="#fff1cc" />
        </linearGradient>
        <radialGradient id={haloId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff8ee" stopOpacity="0.95" />
          <stop offset="35%" stopColor="#f0d48a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#e7c56a" stopOpacity="0" />
        </radialGradient>
      </defs>

      <path ref={guideRef} d={GUIDE} fill="none" stroke="none" />
      <path
        d={GUIDE}
        pathLength={100}
        fill="none"
        stroke="color-mix(in srgb, var(--accent) 48%, var(--line))"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
      <path
        d={GUIDE}
        pathLength={100}
        fill="none"
        stroke={`url(#${goldId})`}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={100}
        className="path-swoosh-reveal"
        style={{ strokeDashoffset: hidden }}
      />
      <path
        d={GUIDE}
        pathLength={100}
        fill="none"
        stroke="#fff4dc"
        strokeWidth={1.05}
        strokeLinecap="round"
        strokeDasharray={100}
        opacity={0.72}
        className="path-swoosh-reveal"
        style={{ strokeDashoffset: hidden }}
      />
      <circle ref={haloRef} r="11" fill={`url(#${haloId})`} opacity="0" />
      <circle ref={tailBRef} r="1.35" fill="#e7c56a" opacity="0" />
      <circle ref={tailARef} r="1.85" fill="#f4e0a8" opacity="0" />
      <circle ref={headRef} r="2.7" fill="#fff8ee" opacity="0" />
    </svg>
  );
}

/** Progress for a path that is still being written. */
export function PathBuildCard({ milestones, lessonOneReady, lessonOrder = 1, onStartLesson, embedded = false }: Props) {
  const active = milestones.find((step) => step.state === "active");
  const progress = lightProgress(milestones);
  const frame = embedded
    ? ""
    : `overflow-hidden rounded-2xl border bg-[var(--sidebar)] ${
        lessonOneReady
          ? "study-ready border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]"
          : "border-[var(--line)]"
      }`;

  return (
    <section aria-label="Path building" className={frame}>
      <div className={embedded ? "px-4 pb-4 pt-5 sm:px-6 sm:pt-6" : "px-4 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6"}>
        <PathSwoosh progress={progress} />
        <ol aria-label="Build stages" className="mt-1 grid grid-cols-4 gap-1.5 sm:mt-2 sm:gap-2">
          {milestones.map((step) => (
            <li key={step.id} aria-current={step.state === "active" ? "step" : undefined} className="min-w-0">
              <span className={`block h-[3px] rounded-full ${segmentClass(step.state)}`} />
              <span className={`mt-2 block text-[11px] leading-tight tracking-[0.01em] sm:text-xs ${labelClass(step.state)}`}>
                <span className="sr-only">
                  {step.label}. {step.state === "done" ? "Done." : step.state === "active" ? "In progress." : "Not started."}
                </span>
                <span aria-hidden>{SHORT[step.id]}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4">
          {lessonOneReady ? (
            <>
              <p className="study-serif break-words text-xl italic leading-snug text-[var(--ink)]">Lesson {lessonOrder} is ready</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--ink-muted)]">
                Start now. The other lessons keep being written in the background.
              </p>
              {onStartLesson ? (
                <button
                  type="button"
                  onClick={onStartLesson}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[#1c1a16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:w-auto"
                >
                  Start Lesson {lessonOrder}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium tracking-[-0.01em] text-[var(--ink)]">{active?.label ?? "Preparing the path"}</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--ink-muted)]">
                {active?.detail ?? "The path is being gathered."}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

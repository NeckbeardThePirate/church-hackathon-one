"use client";

type Props = {
  size?: number;
  /** Flame and glow move. A quiet lamp is for a lost connection or a finished beat. */
  live?: boolean;
  className?: string;
};

/** Oil lamp on an open page. Decoration for waiting; the words beside it carry the facts. */
export function StudyLamp({ size = 56, live = true, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={Math.round(size * 0.82)}
      viewBox="0 0 64 52"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <g className={live ? "study-breathe" : undefined} opacity={live ? 1 : 0.45}>
        <ellipse cx="40" cy="18" rx="14" ry="10" fill="#c9b896" opacity={live ? 0.22 : 0.08} />
      </g>
      <g className={live ? "study-flicker" : undefined} opacity={live ? 1 : 0.35}>
        <path d="M40 3 C45 10 46 15 40 21 C34 15 35 10 40 3 Z" fill="#e7c56a" />
        <path d="M40 9 C42.2 13 42.2 16 40 18.5 C37.8 16 37.8 13 40 9 Z" fill="#fff3d2" />
      </g>
      <path
        d="M8 34 C8 27 18 23 30 23 C36 23 40 24.5 43 27 L47 24.5 C49.2 23.4 50.4 26 48.2 28.2 L42 34 C40 40 33 43 25 43 C15 43 8 40 8 34 Z"
        fill="#b8734a"
      />
      <path d="M11 34 C14 38 22 39.5 28 39.5 C34 39.5 38 37.5 40 34" stroke="#8f5536" strokeWidth="1.2" fill="none" />
      <ellipse cx="26" cy="29" rx="5.5" ry="2" fill="#6e3f27" />
      <path d="M8 33 C3.5 32 2.2 27.5 5.5 26" stroke="#b8734a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path
        className={live ? "study-ink" : undefined}
        d="M14 48 H50"
        stroke="#c9b896"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

export function StudyShimmer({ className = "" }: { className?: string }) {
  const display = className.includes("inline") ? "" : "block";
  return <span className={`study-shimmer rounded-md bg-[var(--line)] ${display} ${className}`} aria-hidden />;
}

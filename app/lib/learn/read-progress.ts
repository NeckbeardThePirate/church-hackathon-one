/** Pure reading-progress math. The lesson view turns scroll and section positions into these numbers. */

export function scrollDepthPercent(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const max = scrollHeight - clientHeight;
  if (max <= 8) return 100;
  if (!Number.isFinite(scrollTop) || scrollTop <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((scrollTop / max) * 100)));
}

/**
 * Share of sections the reader has moved through.
 * A section counts when its bottom has reached the viewport's bottom edge,
 * so a tall block is not finished just because its first line is on screen.
 */
export function sectionVisibilityPercent(
  sections: { top: number; bottom: number }[],
  viewportTop: number,
  viewportHeight: number,
): number | null {
  if (!sections.length || viewportHeight <= 0) return null;
  const line = viewportTop + viewportHeight;
  let seen = 0;
  for (const section of sections) {
    if (section.bottom <= line && section.top < line) seen += 1;
  }
  return Math.round((seen / sections.length) * 100);
}

/** Reading percent never moves backward. Scroll depth and section visibility both count. */
export function combineReadPercent(scrollPct: number, sectionPct: number | null, previous: number): number {
  const scroll = Number.isFinite(scrollPct) ? scrollPct : 0;
  const section = sectionPct == null || !Number.isFinite(sectionPct) ? 0 : sectionPct;
  const prior = Number.isFinite(previous) ? previous : 0;
  return Math.min(100, Math.max(0, Math.round(Math.max(prior, scroll, section))));
}

export function readPercentMarksDone(percent: number): boolean {
  return percent >= 92;
}

/** A placeholder page is not a lesson the learner has read. */
export function lessonCanBeMarkedRead(
  lesson: { status?: string; teaching?: readonly unknown[] } | null | undefined,
): boolean {
  if (!lesson || lesson.status === "pending") return false;
  return (lesson.teaching?.length ?? 0) > 0;
}

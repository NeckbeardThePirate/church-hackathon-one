const REFORMED_DOC = /westminster|heidelberg|belgic|dort|canons/i;

/** When the plan teaches from the Reformed tradition, put its standards first. */
export function rankForPerspective<T extends { document?: string; label?: string | null }>(
  hits: T[],
  perspective: string,
): T[] {
  if (perspective !== "Reformed") return hits;
  return [...hits].sort((a, b) => {
    const score = (hit: T) => (REFORMED_DOC.test(`${hit.document ?? ""} ${hit.label ?? ""}`) ? 1 : 0);
    return score(b) - score(a);
  });
}

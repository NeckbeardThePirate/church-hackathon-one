/**
 * Gap lessons: one short practice lesson for concepts a learner missed.
 * Caps are enforced here so the route, the plan DO, and the quiz screen agree.
 */
import { CONCEPT_ID } from "./attempts.ts";
import { lessonKind } from "./types.ts";

/** A core lesson can spawn at most this many gap lessons. */
export const MAX_GAP_LESSONS_PER_CORE = 3;

/** Simple-band sitting. Inside the 15–30 minute simple lesson range. */
export const GAP_SITTING_MINUTES = 20;

const MAX_CONCEPTS = 12;

export type GapConcept = {
  conceptId: string;
  conceptLabel: string;
};

export type GapRequest = {
  sourceLessonId: string;
  concepts: GapConcept[];
};

export type GapSkipReason = "covered" | "capped";

export type GapSkip = {
  conceptId: string;
  reason: GapSkipReason;
};

/** Lesson fields the cap check needs. Pending tickets use the same shape. */
export type GapLessonRef = {
  id: string;
  kind?: string;
  sourceLessonId?: string;
  sourceConceptIds?: string[];
};

export type GapSelection = {
  concepts: GapConcept[];
  skipped: GapSkip[];
  error?: string;
};

export type GapReserveResult = {
  queued: boolean;
  lessonId?: string;
  conceptIds: string[];
  skipped: GapSkip[];
  error?: string;
};

export function gapConceptLine(concept: GapConcept): string {
  return `- conceptId: ${concept.conceptId} | conceptLabel: ${concept.conceptLabel}`;
}

export function practiceTitle(concepts: GapConcept[]): string {
  const joined = concepts
    .map((concept) => concept.conceptLabel.trim())
    .filter(Boolean)
    .join(", ");
  if (!joined) return "Practice";
  const clipped = joined.length > 72 ? `${joined.slice(0, 69)}…` : joined;
  return `Practice: ${clipped}`;
}

export function nextGapLessonId(sourceLessonId: string, usedIds: string[]): string {
  const safe = sourceLessonId.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 40) || "lesson";
  let n = 1;
  let id = `gap-${safe}-${n}`;
  while (usedIds.includes(id)) {
    n += 1;
    id = `gap-${safe}-${n}`;
  }
  return id;
}

/** Concept ids that already have a gap lesson on this plan, including ones still being built. */
export function coveredConceptIds(lessons: GapLessonRef[]): Set<string> {
  const ids = new Set<string>();
  for (const lesson of lessons) {
    if (lessonKind(lesson) !== "gap") continue;
    for (const id of lesson.sourceConceptIds ?? []) {
      if (id) ids.add(id);
    }
  }
  return ids;
}

export function gapLessonsForSource(lessons: GapLessonRef[], sourceLessonId: string): GapLessonRef[] {
  return lessons.filter((lesson) => lessonKind(lesson) === "gap" && lesson.sourceLessonId === sourceLessonId);
}

/**
 * Drop concepts that already have a gap lesson. Refuse a fourth gap from the same core lesson.
 * A gap lesson cannot be the source of another gap.
 */
export function selectGapConcepts(lessons: GapLessonRef[], sourceLessonId: string, concepts: GapConcept[]): GapSelection {
  const source = lessons.find((lesson) => lesson.id === sourceLessonId);
  if (!source || lessonKind(source) === "gap") {
    return { concepts: [], skipped: [], error: "Unknown lesson." };
  }

  const covered = coveredConceptIds(lessons);
  const skipped: GapSkip[] = [];
  const fresh: GapConcept[] = [];
  for (const concept of concepts) {
    if (covered.has(concept.conceptId) || fresh.some((item) => item.conceptId === concept.conceptId)) {
      skipped.push({ conceptId: concept.conceptId, reason: "covered" });
      continue;
    }
    fresh.push(concept);
  }
  if (!fresh.length) return { concepts: [], skipped };

  if (gapLessonsForSource(lessons, sourceLessonId).length >= MAX_GAP_LESSONS_PER_CORE) {
    return {
      concepts: [],
      skipped: [...skipped, ...fresh.map((concept) => ({ conceptId: concept.conceptId, reason: "capped" as const }))],
      error: "This lesson already has three practice lessons.",
    };
  }
  return { concepts: fresh, skipped };
}

/** Place a gap lesson immediately after its parent and any practice lessons that parent already has. */
export function insertGapLesson<T extends GapLessonRef>(lessons: T[], gap: T): T[] {
  const without = lessons.filter((lesson) => lesson.id !== gap.id);
  const parentId = gap.sourceLessonId;
  let index = parentId ? without.findIndex((lesson) => lesson.id === parentId) : -1;
  if (index < 0) return [...without, gap];
  index += 1;
  while (index < without.length && lessonKind(without[index]!) === "gap" && without[index]!.sourceLessonId === parentId) {
    index += 1;
  }
  const next = without.slice();
  next.splice(index, 0, gap);
  return next;
}

/** Final assessment is mixed from core lessons only. */
export function lessonsForFinalMix<T extends { kind?: string; teaching?: { length: number } }>(lessons: readonly T[]): T[] {
  const ready: T[] = [];
  for (const lesson of lessons) {
    if (lessonKind(lesson) === "core" && (lesson.teaching?.length ?? 0) > 0) ready.push(lesson);
  }
  return ready;
}

/** Missed, tagged answers. Untagged misses and repeats are left out. */
export function missedGapConcepts(
  answers: { correct: boolean | null; conceptId?: string; conceptLabel?: string }[],
): GapConcept[] {
  const concepts: GapConcept[] = [];
  for (const answer of answers) {
    if (answer.correct !== false || !answer.conceptId) continue;
    if (concepts.some((concept) => concept.conceptId === answer.conceptId)) continue;
    const label = answer.conceptLabel?.trim() || answer.conceptId;
    concepts.push({ conceptId: answer.conceptId, conceptLabel: label });
  }
  return concepts;
}

export function parseGapRequest(body: unknown): { ok: true; request: GapRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Gap body must be an object." };
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.sourceLessonId !== "string" || raw.sourceLessonId.trim().length === 0 || raw.sourceLessonId.length > 80) {
    return { ok: false, error: "sourceLessonId is required." };
  }
  if (!Array.isArray(raw.concepts) || raw.concepts.length < 1 || raw.concepts.length > MAX_CONCEPTS) {
    return { ok: false, error: "concepts must be a list of 1 to 12 missed concepts." };
  }
  const concepts: GapConcept[] = [];
  for (let i = 0; i < raw.concepts.length; i++) {
    const item = raw.concepts[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: `concepts[${i}] must be an object.` };
    }
    const row = item as Record<string, unknown>;
    if (typeof row.conceptId !== "string" || !CONCEPT_ID.test(row.conceptId)) {
      return { ok: false, error: `concepts[${i}].conceptId must be a short slug.` };
    }
    if (typeof row.conceptLabel !== "string" || row.conceptLabel.trim().length === 0 || row.conceptLabel.length > 200) {
      return { ok: false, error: `concepts[${i}].conceptLabel must be a short string.` };
    }
    if (concepts.some((concept) => concept.conceptId === row.conceptId)) continue;
    concepts.push({ conceptId: row.conceptId, conceptLabel: row.conceptLabel.trim() });
  }
  if (!concepts.length) return { ok: false, error: "concepts must include a concept id." };
  return { ok: true, request: { sourceLessonId: raw.sourceLessonId, concepts } };
}

/**
 * Gap lessons: one short practice lesson for concepts a learner missed.
 * Caps are enforced here so the route, the plan DO, and the quiz screen agree.
 */
import { CONCEPT_ID } from "./attempts.ts";
import { lessonKind } from "./types.ts";

/** A core lesson can spawn at most this many gap lessons. */
export const MAX_GAP_LESSONS_PER_CORE = 3;

/** Re-queue a practice lesson that was reserved but never taught. */
export const GAP_REQUEUE_AFTER_MS = 20_000;

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
export function coveredConceptIds(lessons: readonly GapLessonRef[]): Set<string> {
  const ids = new Set<string>();
  for (const lesson of lessons) {
    if (lessonKind(lesson) !== "gap") continue;
    for (const id of lesson.sourceConceptIds ?? []) {
      if (id) ids.add(id);
    }
  }
  return ids;
}

export function gapLessonsForSource(lessons: readonly GapLessonRef[], sourceLessonId: string): GapLessonRef[] {
  return lessons.filter((lesson) => lessonKind(lesson) === "gap" && lesson.sourceLessonId === sourceLessonId);
}

/**
 * Drop concepts that already have a gap lesson. Refuse a fourth gap from the same core lesson.
 * A gap lesson cannot be the source of another gap.
 */
export function selectGapConcepts(
  lessons: readonly GapLessonRef[],
  sourceLessonId: string,
  concepts: GapConcept[],
): GapSelection {
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

/** A reserved job with no timestamp, or one older than the requeue window, can be queued again. */
export function gapTicketIsStale(queuedAt: number | undefined, now: number): boolean {
  if (queuedAt == null) return true;
  return now - queuedAt >= GAP_REQUEUE_AFTER_MS;
}

type ConceptLesson = GapLessonRef & {
  quiz?: readonly { conceptId?: string; conceptLabel?: string }[];
};

/** Core lesson that taught this concept. Final items often reuse that concept id or label. */
export function sourceLessonIdForConcept(lessons: readonly ConceptLesson[], concept: GapConcept): string | null {
  const cores = lessons.filter((lesson) => lessonKind(lesson) !== "gap");
  for (const lesson of cores) {
    if (lesson.quiz?.some((item) => item.conceptId === concept.conceptId)) return lesson.id;
  }
  const label = concept.conceptLabel.trim().toLowerCase();
  if (label) {
    for (const lesson of cores) {
      if (lesson.quiz?.some((item) => (item.conceptLabel ?? "").trim().toLowerCase() === label)) return lesson.id;
    }
  }
  for (const lesson of cores) {
    if (concept.conceptId === lesson.id || concept.conceptId.startsWith(`${lesson.id}-`)) return lesson.id;
  }
  return null;
}

/** One gap request per core lesson. Concepts with no source lesson are left for review. */
export function groupMissesBySource(lessons: readonly ConceptLesson[], concepts: readonly GapConcept[]): GapRequest[] {
  const groups = new Map<string, GapConcept[]>();
  for (const concept of concepts) {
    const sourceLessonId = sourceLessonIdForConcept(lessons, concept);
    if (!sourceLessonId) continue;
    const list = groups.get(sourceLessonId) ?? [];
    if (!list.some((item) => item.conceptId === concept.conceptId)) list.push(concept);
    groups.set(sourceLessonId, list);
  }
  return [...groups].map(([sourceLessonId, grouped]) => ({ sourceLessonId, concepts: grouped }));
}

export function missedFromQuiz(
  items: readonly { conceptId?: string; conceptLabel?: string }[],
  answers: readonly { correct: boolean | null }[],
): GapConcept[] {
  return missedGapConcepts(
    items.map((item, index) => ({
      correct: answers[index]?.correct ?? null,
      conceptId: item.conceptId,
      conceptLabel: item.conceptLabel,
    })),
  );
}

export type PracticeCard = {
  key: string;
  sourceLessonId: string;
  concepts: GapConcept[];
  gapLessonId?: string;
  title?: string;
};

/**
 * Open cards for gap lessons already on the plan, plus a generate card for misses
 * that do not have one yet. Caps and covered concepts are applied here.
 */
export function practiceCards(
  lessons: readonly (ConceptLesson & { title?: string; sourceConceptIds?: string[] })[],
  misses: readonly { sourceLessonId: string; concepts: GapConcept[] }[],
): PracticeCard[] {
  const cards: PracticeCard[] = [];
  for (const lesson of lessons) {
    if (lessonKind(lesson) !== "gap" || !lesson.sourceLessonId) continue;
    cards.push({
      key: lesson.id,
      sourceLessonId: lesson.sourceLessonId,
      concepts: (lesson.sourceConceptIds ?? []).map((conceptId) => ({ conceptId, conceptLabel: conceptId })),
      gapLessonId: lesson.id,
      title: lesson.title,
    });
  }
  for (const miss of misses) {
    const selection = selectGapConcepts(lessons, miss.sourceLessonId, miss.concepts);
    if (!selection.concepts.length) continue;
    cards.push({
      key: `miss:${miss.sourceLessonId}:${selection.concepts.map((concept) => concept.conceptId).join(",")}`,
      sourceLessonId: miss.sourceLessonId,
      concepts: selection.concepts,
    });
  }
  return cards;
}

export function practiceCardHeading(card: PracticeCard): string {
  if (card.gapLessonId) return card.title ? `Practice lesson ready: ${card.title}` : "Practice lesson ready";
  return "Generate gap lesson";
}

type StoredGapLesson = GapLessonRef & {
  title?: string;
  status?: string;
  teaching?: readonly unknown[];
  quiz?: readonly unknown[];
};

/** A gap on the live plan is ready once check has saved it. A reserved ticket is not on the plan yet. */
function liveGapReady(lesson: StoredGapLesson): boolean {
  if (lessonKind(lesson) !== "gap" || !lesson.sourceLessonId) return false;
  if ((lesson.teaching?.length ?? 0) > 0) return true;
  return lesson.status === "ok" || lesson.status === "degraded";
}

/** Replace a snapshot copy when the live lesson is the one that was actually built. */
function liveGapRicher(current: StoredGapLesson, live: StoredGapLesson): boolean {
  if (lessonKind(current) !== "gap") return true;
  if ((live.teaching?.length ?? 0) > (current.teaching?.length ?? 0)) return true;
  if (!current.title && live.title) return true;
  if ((live.status === "ok" || live.status === "degraded") && current.status !== live.status) return true;
  return false;
}

/**
 * Copy finished gap lessons from the live plan onto a workspace snapshot that left them out.
 * The snapshot array is returned unchanged when it already has each ready gap.
 */
export function adoptLiveGapLessons<T extends StoredGapLesson>(snapshot: readonly T[], live: readonly T[]): readonly T[] {
  let next: T[] | null = null;
  for (const lesson of live) {
    if (!liveGapReady(lesson)) continue;
    const list: T[] = next ?? snapshot.slice();
    const index = list.findIndex((item) => item.id === lesson.id);
    if (index < 0) {
      next = insertGapLesson(list, lesson);
      continue;
    }
    if (!liveGapRicher(list[index]!, lesson)) continue;
    next = insertGapLesson(
      list.filter((item) => item.id !== lesson.id),
      lesson,
    );
  }
  return next ?? snapshot;
}

/** A written core lesson replaces a pending shell that has less of the page. */
function liveCoreRicher(current: StoredGapLesson, live: StoredGapLesson): boolean {
  if (lessonKind(current) === "gap" || lessonKind(live) === "gap") return false;
  const currentTeaching = current.teaching?.length ?? 0;
  const liveTeaching = live.teaching?.length ?? 0;
  if (liveTeaching > currentTeaching) return true;
  const currentQuiz = current.quiz?.length ?? 0;
  const liveQuiz = live.quiz?.length ?? 0;
  if (current.status === "pending" && liveQuiz > currentQuiz) return true;
  return current.status === "pending" && live.status != null && live.status !== "pending" && liveTeaching > 0;
}

/**
 * Replace a pending core lesson when the live plan has its teaching.
 * A thinner live copy never overwrites a page that is already written.
 */
export function adoptLiveCoreLessons<T extends StoredGapLesson>(snapshot: readonly T[], live: readonly T[]): readonly T[] {
  let next: T[] | null = null;
  for (const lesson of live) {
    if (lessonKind(lesson) === "gap") continue;
    const list: readonly T[] = next ?? snapshot;
    const index = list.findIndex((item) => item.id === lesson.id);
    if (index < 0) continue;
    if (!liveCoreRicher(list[index]!, lesson)) continue;
    const copy: T[] = list.slice();
    copy[index] = lesson;
    next = copy;
  }
  return next ?? snapshot;
}

/** Keep every other plan field. The lesson list can gain a live gap or a finished core page. */
export function adoptLivePlan<T extends { id: string; lessons: readonly StoredGapLesson[] }>(
  snapshot: T,
  live: { id?: string; lessons?: readonly StoredGapLesson[] } | null | undefined,
): T {
  if (!live || live.id !== snapshot.id || !live.lessons) return snapshot;
  const withGaps = adoptLiveGapLessons(snapshot.lessons, live.lessons as readonly T["lessons"][number][]);
  const lessons = adoptLiveCoreLessons(withGaps, live.lessons as readonly T["lessons"][number][]);
  if (lessons === snapshot.lessons) return snapshot;
  return { ...snapshot, lessons: lessons as T["lessons"] };
}

/** Keep gap lessons a newer project save dropped. Incoming copies of the same id win. */
export function preserveGapLessons<T extends GapLessonRef>(incoming: readonly T[], stored: readonly T[]): T[] {
  let next = incoming.slice();
  const ids = new Set(next.map((lesson) => lesson.id));
  for (const lesson of stored) {
    if (lessonKind(lesson) !== "gap" || !lesson.sourceLessonId || ids.has(lesson.id)) continue;
    next = insertGapLesson(next, lesson);
    ids.add(lesson.id);
  }
  return next;
}

/** Copy a known lesson concept onto a final item when the model reused its id or label. */
export function attachFinalConcepts<T extends { conceptId?: string; conceptLabel?: string }>(
  items: readonly T[],
  lessons: readonly ConceptLesson[],
): T[] {
  const catalog: GapConcept[] = [];
  for (const lesson of lessons) {
    if (lessonKind(lesson) === "gap") continue;
    for (const item of lesson.quiz ?? []) {
      if (!item.conceptId) continue;
      catalog.push({ conceptId: item.conceptId, conceptLabel: item.conceptLabel?.trim() || item.conceptId });
    }
  }
  const byId = new Map(catalog.map((concept) => [concept.conceptId, concept]));
  const byLabel = new Map(
    catalog.filter((concept) => concept.conceptLabel.trim()).map((concept) => [concept.conceptLabel.trim().toLowerCase(), concept]),
  );
  return items.map((item) => {
    const known = item.conceptId ? byId.get(item.conceptId) : undefined;
    const labeled = item.conceptLabel ? byLabel.get(item.conceptLabel.trim().toLowerCase()) : undefined;
    const match = known ?? labeled;
    if (!match) return item;
    return { ...item, conceptId: match.conceptId, conceptLabel: match.conceptLabel || item.conceptLabel };
  });
}

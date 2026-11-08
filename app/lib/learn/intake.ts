/**
 * Combined Learn intake: any mix of topic, notes, passages and photo text feeds one plan.
 * Pure helpers shared by the start form and the API route (no browser or Worker APIs).
 */
import { MAX_PASSAGES, parsePassage, type PassageRef } from "../bible/parse-reference.ts";

export const MAX_TOPIC = 500;
export const MAX_NOTES = 20_000;
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_TEXT = 10_000;
/** Merged notes stored with the plan; stages clip further per prompt. */
export const MAX_MERGED_NOTES = MAX_NOTES + MAX_PHOTOS * MAX_PHOTO_TEXT;

export type PhotoText = { name: string; text: string };

export type IntakeInput = {
  topic: string;
  notes: string;
  passages: PassageRef[];
  photos: PhotoText[];
};

/** Notes first, then each photo's text under its file name. Blank photos are skipped. */
export function mergeNotes(notes: string, photos: PhotoText[]): string {
  const blocks = [notes.trim()];
  for (const photo of photos) {
    const text = photo.text.trim();
    if (!text) continue;
    const name = photo.name.replace(/[\[\]\n]/g, " ").trim();
    blocks.push(name ? `[Photo: ${name}]\n${text}` : text);
  }
  return blocks.filter(Boolean).join("\n\n---\n\n");
}

/** Title used when the learner leaves the topic blank. */
export function deriveTopic({ topic, notes, passages, photos }: IntakeInput): string {
  const t = topic.trim();
  if (t) return t.slice(0, MAX_TOPIC);
  if (passages.length) {
    const labels = passages.slice(0, 3).map((p) => p.label);
    return `Study of ${labels.join("; ")}${passages.length > 3 ? " and more" : ""}`.slice(0, MAX_TOPIC);
  }
  for (const source of [notes, ...photos.map((p) => p.text)]) {
    const line = source
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length >= 3 && !/^\[.*\]$/.test(l) && l !== "---");
    if (line) return line.slice(0, 120);
  }
  return "";
}

/** True when there is enough to build a path: a real topic, notes, a passage, or photo text. */
export function hasIntake(input: IntakeInput): boolean {
  return deriveTopic(input).length >= 3;
}

export type IntakeBody = {
  topic?: unknown;
  notes?: unknown;
  passages?: unknown;
  photos?: unknown;
};

export type IntakeResult =
  | { ok: true; topic: string; notes: string; passages: PassageRef[]; sources: { photos: number; passages: number; notes: boolean } }
  | { ok: false; error: string };

/** Validate a POST /api/learn/plans body. Legacy bodies ({topic, notes}) are the degenerate case. */
export function parseIntakeBody(body: IntakeBody): IntakeResult {
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (topic.length > MAX_TOPIC) return { ok: false, error: `Topic must be under ${MAX_TOPIC} characters.` };
  if (notes.length > MAX_NOTES) return { ok: false, error: `Notes must be under ${MAX_NOTES} characters.` };

  const passages: PassageRef[] = [];
  if (body.passages !== undefined) {
    if (!Array.isArray(body.passages)) return { ok: false, error: "Passages must be a list." };
    for (const raw of body.passages) {
      const ref = typeof raw === "string" ? parsePassage(raw) : null;
      if (!ref) return { ok: false, error: `Not a Bible passage: ${String(typeof raw === "string" ? raw : "").slice(0, 60)}` };
      if (!passages.some((p) => p.label === ref.label)) passages.push(ref);
    }
    if (passages.length > MAX_PASSAGES) return { ok: false, error: `Up to ${MAX_PASSAGES} passages.` };
  }

  const photos: PhotoText[] = [];
  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos)) return { ok: false, error: "Photos must be a list." };
    if (body.photos.length > MAX_PHOTOS) return { ok: false, error: `Up to ${MAX_PHOTOS} photos.` };
    for (const raw of body.photos) {
      const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const text = typeof rec.text === "string" ? rec.text.trim() : "";
      if (!text) continue;
      photos.push({ name: typeof rec.name === "string" ? rec.name.slice(0, 120) : "", text: text.slice(0, MAX_PHOTO_TEXT) });
    }
  }

  const input: IntakeInput = { topic, notes, passages, photos };
  if (!hasIntake(input)) return { ok: false, error: "Add a topic, notes, a passage, or a photo." };
  return {
    ok: true,
    topic: deriveTopic(input),
    notes: mergeNotes(notes, photos),
    passages,
    sources: { photos: photos.length, passages: passages.length, notes: notes.length > 0 },
  };
}

/**
 * Plan-context block for stage prompts: learner notes plus the learner's passages.
 * Passage text is supplied by the Bible database, never generated; callers pass resolved text.
 */
export function learnerContext(
  notes: string,
  passages: { reference: string; text: string }[] | undefined,
  limits: { notes: number; passageChars: number },
): string {
  const parts: string[] = [];
  if (notes) {
    parts.push(`Learner notes:\n"""\n${notes.length > limits.notes ? `${notes.slice(0, limits.notes)}…` : notes}\n"""`);
  }
  if (passages?.length) {
    const each = Math.max(200, Math.floor(limits.passageChars / passages.length));
    const body = passages
      .map((p) => `- ${p.reference}: ${p.text.length > each ? `${p.text.slice(0, each)}…` : p.text}`)
      .join("\n");
    parts.push(`Passages the learner chose to study (Bible text, verbatim):\n${body}`);
  }
  return parts.join("\n");
}

/** Learner passage i goes to lesson (i mod lessonCount) + 1: each appears once and the load is spread. */
export function passagesForLesson<T>(passages: T[], order: number, lessonCount: number): T[] {
  return lessonCount > 0 ? passages.filter((_, i) => i % lessonCount === order - 1) : [];
}

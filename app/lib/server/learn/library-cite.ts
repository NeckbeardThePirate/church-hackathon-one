import { findBibleReferences } from "@/app/lib/bible/parse-reference";
import { visibleCitationNote } from "@/app/lib/learn/citation-note";
import type { LibraryCitation, Perspective } from "@/app/lib/learn/types";
import { searchConfessions, searchFathers, type ConfessionHit, type FatherHit, type LibraryEnv } from "../library-search";
import { rankForPerspective } from "./library-rank";

export { rankForPerspective };

function clip(text: string, n: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > n ? `${trimmed.slice(0, n)}…` : trimmed;
}

function toFather(hit: FatherHit): LibraryCitation {
  return {
    id: hit.id,
    source: "father",
    label: hit.author,
    detail: [hit.work, hit.passage].filter(Boolean).join(" · "),
    text: clip(hit.text, 1200),
    note: "",
    ...(hit.condemned ? { condemned: true } : {}),
    ...(hit.sourceUrl ? { url: hit.sourceUrl } : {}),
  };
}

function toConfession(hit: ConfessionHit): LibraryCitation {
  const label = [hit.document, hit.label].filter(Boolean).join(" ");
  return {
    id: hit.id,
    source: "confession",
    label: label || hit.document,
    detail: hit.title ?? undefined,
    text: clip(hit.text, 1200),
    note: "",
    ...(hit.document ? {} : {}),
  };
}

export type LibraryCiteResult = {
  citations: LibraryCitation[];
  /** References that did not parse or did not match a stored row. Wording was not invented. */
  dropped: string[];
};

export type NamedLibraryRef = { reference: string; note: string };

/**
 * Attach fathers and confessions whose text comes from D1.
 * The model never writes these passages. A search failure yields an empty list.
 * A scripture anchor that does not parse is dropped and warned, not guessed.
 */
export async function citeLibrary(
  env: LibraryEnv,
  query: string,
  references: string[],
  perspective: Perspective,
): Promise<LibraryCiteResult> {
  const dropped: string[] = [];
  if (!env.BIBLE) return { citations: [], dropped };
  const refs = [];
  for (const reference of references) {
    const trimmed = reference.trim();
    if (!trimmed) continue;
    const parsed = findBibleReferences(trimmed)[0];
    if (!parsed) {
      dropped.push(trimmed);
      warnDropped(trimmed);
      continue;
    }
    refs.push(parsed);
  }
  try {
    const [fathers, confessions] = await Promise.all([
      searchFathers(env, query, { k: 4, refs, mode: "hybrid" }).catch(() => [] as FatherHit[]),
      searchConfessions(env, query, { k: 4, refs, mode: "hybrid" }).catch(() => [] as ConfessionHit[]),
    ]);
    const rankedConfessions = rankForPerspective(confessions, perspective);
    return {
      citations: [
        ...rankedConfessions.slice(0, 3).map(toConfession),
        ...fathers.slice(0, 3).map(toFather),
      ].filter((item) => item.text.trim()),
      dropped,
    };
  } catch (error) {
    console.warn("[learn] library citation skipped:", error instanceof Error ? error.message : error);
    return { citations: [], dropped };
  }
}

type ConfessionRow = {
  id: string;
  doc_title: string;
  label: string | null;
  title: string | null;
  text: string;
};

type FatherRow = {
  id: string;
  author: string;
  work: string | null;
  source_url: string | null;
  text: string;
  condemned: number | null;
};

/** "Westminster Confession of Faith 11.1" or "John Chrysostom, Homilies on Romans". */
export function splitLibraryReference(reference: string): { head: string; detail: string } | null {
  const trimmed = reference.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const section = /^(.*?)\s+(\d+(?:\.\d+)+)$/.exec(trimmed);
  if (section?.[1] && section[2]) return { head: section[1].trim(), detail: section[2] };
  const comma = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (comma.length >= 2) return { head: comma[0]!, detail: comma.slice(1).join(", ") };
  return { head: trimmed, detail: "" };
}

/**
 * Resolve confession and church-father references the model named.
 * Text is copied from D1. A reference with no row is dropped and warned.
 */
export async function resolveLibraryRefs(
  env: LibraryEnv,
  refs: NamedLibraryRef[],
): Promise<LibraryCiteResult> {
  const citations: LibraryCitation[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  const pending: { reference: string; note: string }[] = [];
  for (const ref of refs) {
    const reference = ref.reference.replace(/\s+/g, " ").trim();
    if (!reference || seen.has(reference.toLowerCase())) continue;
    seen.add(reference.toLowerCase());
    if (!env.BIBLE) {
      dropped.push(reference);
      warnDropped(reference);
      continue;
    }
    pending.push({ reference, note: ref.note });
  }
  const bible = env.BIBLE;
  const looked = await Promise.all(
    pending.map((ref) => (bible ? lookupLibraryRef(bible, ref.reference, ref.note).catch(() => null) : null)),
  );
  looked.forEach((citation, index) => {
    const reference = pending[index]?.reference;
    if (!reference) return;
    if (!citation) {
      dropped.push(reference);
      warnDropped(reference);
      return;
    }
    citations.push(citation);
  });
  return { citations, dropped };
}

export function mergeLibraryCitations(primary: LibraryCitation[], extra: LibraryCitation[]): LibraryCitation[] {
  const seen = new Set<string>();
  const out: LibraryCitation[] = [];
  for (const item of [...primary, ...extra]) {
    if (!item.text.trim()) continue;
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function warnDropped(reference: string): void {
  console.warn(`[learn] library reference dropped (did not resolve): ${reference}`);
}

function connectionNote(note: string, stored: string): string {
  const trimmed = note.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > 240 || trimmed === stored.replace(/\s+/g, " ").trim()) return "";
  return visibleCitationNote(trimmed);
}

async function lookupLibraryRef(db: D1Database, reference: string, note: string): Promise<LibraryCitation | null> {
  const parts = splitLibraryReference(reference);
  if (!parts) return null;
  const confession = await db
    .prepare(
      `SELECT id, doc_title, label, title, text FROM confession_sections
       WHERE lower(id) = lower(?)
          OR (lower(doc_title) = lower(?) AND lower(ifnull(label, '')) = lower(?))
       LIMIT 1`,
    )
    .bind(reference, parts.head, parts.detail)
    .all<ConfessionRow>();
  const confessionRow = confession.results?.[0];
  if (confessionRow?.text.trim()) {
    const label = [confessionRow.doc_title, confessionRow.label].filter(Boolean).join(" ");
    return {
      id: confessionRow.id,
      source: "confession",
      label: label || confessionRow.doc_title,
      detail: confessionRow.title ?? undefined,
      text: clip(confessionRow.text, 1200),
      note: connectionNote(note, confessionRow.text),
    };
  }
  const father = await db
    .prepare(
      `SELECT id, author, work, source_url, text, condemned FROM father_quotes
       WHERE lower(id) = lower(?)
          OR (lower(author) = lower(?) AND lower(ifnull(work, '')) = lower(?))
       LIMIT 1`,
    )
    .bind(reference, parts.head, parts.detail)
    .all<FatherRow>();
  const fatherRow = father.results?.[0];
  if (!fatherRow?.text.trim()) return null;
  return {
    id: fatherRow.id,
    source: "father",
    label: fatherRow.author,
    detail: fatherRow.work ?? undefined,
    text: clip(fatherRow.text, 1200),
    note: connectionNote(note, fatherRow.text),
    ...(fatherRow.condemned === 1 ? { condemned: true } : {}),
    ...(fatherRow.source_url ? { url: fatherRow.source_url } : {}),
  };
}

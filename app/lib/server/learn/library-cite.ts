import { findBibleReferences } from "@/app/lib/bible/parse-reference";
import { visibleCitationNote } from "@/app/lib/learn/citation-note";
import type { LibraryCitation, Perspective } from "@/app/lib/learn/types";
import { searchCommentaries, searchConfessions, searchFathers, type CommentaryHit, type ConfessionHit, type FatherHit, type LibraryEnv } from "../library-search";
import { rankForPerspective, retrievalFocus, selectRelevant } from "./library-rank";

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

function toCommentary(hit: CommentaryHit): LibraryCitation {
  const passage = hit.section || hit.passage;
  return {
    id: hit.id,
    source: "commentary",
    label: hit.author,
    detail: [hit.work, passage, "public domain, CCEL"].filter(Boolean).join(" · "),
    text: clip(hit.text, 1200),
    note: "",
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
 * Attach fathers, confessions, and commentaries whose text comes from D1.
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
    const focus = retrievalFocus(`${query}\n${references.join("\n")}`);
    const searchQuery = [query, ...focus.terms].join(" ").slice(0, 1800);
    const [fathers, confessions, commentaries] = await Promise.all([
      searchFathers(env, searchQuery, { k: 8, refs, mode: "hybrid" }).catch(() => [] as FatherHit[]),
      searchConfessions(env, searchQuery, { k: 12, refs, mode: "hybrid" }).catch(() => [] as ConfessionHit[]),
      searchCommentaries(env, searchQuery, { k: 8, refs, mode: "hybrid" }).catch(() => [] as CommentaryHit[]),
    ]);
    const onPassage = (sources: readonly string[] | undefined) => sources?.includes("verse") === true;
    const rankedConfessions = selectRelevant(
      confessions,
      (hit) => `${hit.document ?? ""} ${hit.label ?? ""} ${hit.title ?? ""} ${hit.text ?? ""}`,
      focus,
      {
        limit: 2,
        perspective,
        reformed: (hit) => /westminster|heidelberg|belgic|dort|canons/i.test(`${hit.document ?? ""} ${hit.label ?? ""}`),
      },
    );
    const rankedCommentaries = selectRelevant(
      commentaries,
      (hit) => `${hit.author} ${hit.work} ${hit.section ?? ""} ${hit.passage} ${hit.text}`,
      focus,
      { limit: 2, keepAnyway: (hit) => onPassage(hit.sources) },
    );
    const rankedFathers = selectRelevant(
      fathers,
      (hit) => `${hit.author} ${hit.work ?? ""} ${hit.passage} ${hit.text}`,
      focus,
      { limit: 2, keepAnyway: (hit) => onPassage(hit.sources) },
    );
    return {
      citations: [
        ...rankedConfessions.map(toConfession),
        ...rankedCommentaries.map(toCommentary),
        ...rankedFathers.map(toFather),
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

/** "Westminster Confession of Faith 11.1", "Westminster Shorter Catechism 100", or "John Chrysostom, Homilies on Romans". */
export function splitLibraryReference(reference: string): { head: string; detail: string } | null {
  const trimmed = reference.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const section = /^(.*?)\s+(Q?\d+(?:\.\d+)*)$/i.exec(trimmed);
  if (section?.[1] && section[2]) return { head: section[1].replace(/,\s*$/, "").trim(), detail: section[2] };
  const comma = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (comma.length >= 2) return { head: comma[0]!, detail: comma.slice(1).join(", ") };
  return { head: trimmed, detail: "" };
}

/** Heidelberg Lord's Days 45–52 are the Lord's Prayer (questions 116–129). */
const HEIDELBERG_LORD_DAYS: Record<number, [number, number]> = {
  45: [116, 119],
  46: [120, 121],
  47: [122, 122],
  48: [123, 123],
  49: [124, 124],
  50: [125, 125],
  51: [126, 126],
  52: [127, 129],
};

function heidelbergLordDay(reference: string): number | null {
  if (!/heidelberg/i.test(reference)) return null;
  const match = /lord'?s\s+day\s+(\d+)/i.exec(reference);
  if (!match) return null;
  const day = Number(match[1]);
  return HEIDELBERG_LORD_DAYS[day] ? day : null;
}

/**
 * Resolve confession, commentary, and church-father references the model named.
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
  const day = heidelbergLordDay(reference);
  if (day) {
    const cited = await lookupHeidelbergDay(db, day, note);
    if (cited) return cited;
  }
  const parts = splitLibraryReference(reference);
  if (!parts) return null;
  const confession = await db
    .prepare(
      `SELECT id, doc_title, label, title, text FROM confession_sections
       WHERE lower(id) = lower(?)
          OR (lower(doc_title) = lower(?) AND (
                lower(ifnull(label, '')) = lower(?)
                OR lower(ifnull(label, '')) = lower('Q' || ?)
                OR lower(replace(ifnull(label, ''), 'Q', '')) = lower(replace(?, 'Q', ''))
              ))
       LIMIT 1`,
    )
    .bind(reference, parts.head, parts.detail, parts.detail.replace(/^Q/i, ""), parts.detail)
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
  if (fatherRow?.text.trim()) {
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
  return lookupCommentary(db, reference, note);
}

const LOC = 1_000_000;

type CommentaryRow = {
  id: string;
  author: string;
  work: string;
  section_label: string | null;
  source_url: string | null;
  text: string;
};

function questionNumber(label: string | null): number {
  const match = /(\d+)/.exec(label ?? "");
  return match ? Number(match[1]) : 0;
}

async function lookupHeidelbergDay(db: D1Database, day: number, note: string): Promise<LibraryCitation | null> {
  const range = HEIDELBERG_LORD_DAYS[day];
  if (!range) return null;
  const labels: string[] = [];
  for (let number = range[0]; number <= range[1]; number += 1) labels.push(`Q${number}`);
  const { results } = await db
    .prepare(
      `SELECT id, doc_title, label, title, text FROM confession_sections
       WHERE doc_slug = 'heidelberg_catechism' AND label IN (${labels.map(() => "?").join(",")})`,
    )
    .bind(...labels)
    .all<ConfessionRow>();
  const rows = [...(results ?? [])].sort((a, b) => questionNumber(a.label) - questionNumber(b.label));
  const text = rows.map((row) => row.text.trim()).filter(Boolean).join("\n\n");
  if (!text) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return null;
  return {
    id: `heidelberg_catechism:LD${day}`,
    source: "confession",
    label: `Heidelberg Catechism Lord's Day ${day}`,
    detail: first.label === last.label ? (first.label ?? undefined) : `${first.label}–${last.label}`,
    text: clip(text, 1200),
    note: connectionNote(note, text),
  };
}

function commentaryCitation(row: CommentaryRow, note: string): LibraryCitation {
  return {
    id: row.id,
    source: "commentary",
    label: row.author,
    detail: [row.work, row.section_label, "public domain, CCEL"].filter(Boolean).join(" · "),
    text: clip(row.text, 1200),
    note: connectionNote(note, row.text),
    ...(row.source_url ? { url: row.source_url } : {}),
  };
}

async function lookupCommentary(db: D1Database, reference: string, note: string): Promise<LibraryCitation | null> {
  const byId = await db
    .prepare(
      `SELECT id, author, work, section_label, source_url, text FROM commentary_entries
       WHERE lower(id) = lower(?) LIMIT 1`,
    )
    .bind(reference)
    .all<CommentaryRow>();
  const named = byId.results?.[0];
  if (named?.text.trim()) return commentaryCitation(named, note);
  const parsed = findBibleReferences(reference)[0];
  if (!parsed || !/henry|commentary/i.test(reference)) return null;
  const start = parsed.chapter * LOC + parsed.verseStart;
  const end = parsed.chapter * LOC + parsed.verseEnd;
  const { results } = await db
    .prepare(
      `SELECT id, author, work, section_label, source_url, text FROM commentary_entries
       WHERE book_id = ? AND loc_start <= ? AND loc_end >= ?
       ORDER BY (loc_end - loc_start) ASC, length(text) DESC LIMIT 1`,
    )
    .bind(parsed.book.id, end, start)
    .all<CommentaryRow>();
  const row = results?.[0];
  return row?.text.trim() ? commentaryCitation(row, note) : null;
}

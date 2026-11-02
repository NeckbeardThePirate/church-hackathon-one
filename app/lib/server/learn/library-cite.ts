import { findBibleReferences } from "@/app/lib/bible/parse-reference";
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
    note: hit.passage ? `Comment on ${hit.passage}.` : "From the retrieved commentary text.",
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
    note: "Quoted from the confession text stored for this section.",
    ...(hit.document ? {} : {}),
  };
}

/**
 * Attach fathers and confessions whose text comes from D1.
 * The model never writes these passages. A search failure yields an empty list.
 */
export async function citeLibrary(
  env: LibraryEnv,
  query: string,
  references: string[],
  perspective: Perspective,
): Promise<LibraryCitation[]> {
  if (!env.BIBLE) return [];
  const refs = references.flatMap((reference) => findBibleReferences(reference).slice(0, 1));
  try {
    const [fathers, confessions] = await Promise.all([
      searchFathers(env, query, { k: 4, refs, mode: "hybrid" }).catch(() => [] as FatherHit[]),
      searchConfessions(env, query, { k: 4, refs, mode: "hybrid" }).catch(() => [] as ConfessionHit[]),
    ]);
    const rankedConfessions = rankForPerspective(confessions, perspective);
    return [
      ...rankedConfessions.slice(0, 3).map(toConfession),
      ...fathers.slice(0, 3).map(toFather),
    ];
  } catch (error) {
    console.warn("[learn] library citation skipped:", error instanceof Error ? error.message : error);
    return [];
  }
}

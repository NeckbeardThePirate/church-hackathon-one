import { findBibleReferences } from "../bible/parse-reference";
import { fetchPassageFromD1 } from "./bible-db";
import { fetchFurtherReading, type ReadingItem } from "./further-reading";
import { searchConfessions, searchFathers, type ConfessionHit, type FatherHit, type LibraryEnv } from "./library-search";
import { parseWorkersAiText } from "./ocr";
import { REFINE_MODEL } from "./refine-ocr";
import { searchScripture, type ScriptureHit } from "./scripture-search";

export type DeeperCrossReference = {
  reference: string;
  note: string;
  /** BSB text pulled from D1; absent if the reference could not be verified. */
  text?: string;
  verified: boolean;
};

/** Retrieved source text (never model-generated) plus an optional AI note on relevance. */
export type DeeperFather = FatherHit & { note: string };
export type DeeperConfession = ConfessionHit & { note: string };

export type GoDeeperResult = {
  theme: string;
  crossReferences: DeeperCrossReference[];
  fathers: DeeperFather[];
  confessions: DeeperConfession[];
  /** Hybrid (semantic + full-text) verse matches for the block text. */
  related: ScriptureHit[];
  /** Articles / videos (real search results, or curated site-search links). */
  furtherReading: ReadingItem[];
};

type DeeperEnv = LibraryEnv & { AI: Ai; SCRIPTURE_VECTORS?: VectorizeIndex };

const SYSTEM = `You are a careful theological research assistant for Bible study.
You receive study notes plus CANDIDATE sources retrieved from a database: Bible verses (V), church father comments (F#), and confession/catechism sections (C#).
Return:
- theme: short phrase naming the doctrine/topic.
- crossReferences: 4-8 Bible passages that illuminate the notes. Prefer candidate verses; you may add others. Format "Book C:V" or "Book C:V-V".
- fathers: pick up to 5 of the F# candidates that genuinely speak to the notes, best first. Use their ids only.
- confessions: pick up to 5 of the C# candidates that genuinely speak to the notes, best first. Use their ids only.
- searchQueries: 2-3 short web search queries (3-6 words) a student would use to find good articles and videos on this topic.
Each "note" is one sentence explaining the connection. Never invent ids. Skip weak candidates.
Return ONLY JSON:
{"theme":"","crossReferences":[{"reference":"","note":""}],"fathers":[{"id":"F1","note":""}],"confessions":[{"id":"C1","note":""}],"searchQueries":[""]}`;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arr(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

function parseJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  return JSON.parse(jsonText) as Record<string, unknown>;
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);

export async function runGoDeeper(env: DeeperEnv, text: string): Promise<GoDeeperResult> {
  const db = env.BIBLE;
  const refs = findBibleReferences(text);
  const none = <T>() => [] as T[];

  const [related, fatherHits, confessionHits] = db
    ? await Promise.all([
        searchScripture(env, text, { k: 15 }).catch(none<ScriptureHit>),
        searchFathers(env, text, { k: 12, refs }).catch(none<FatherHit>),
        searchConfessions(env, text, { k: 12, refs }).catch(none<ConfessionHit>),
      ])
    : [[], [], []];

  const candidates = [
    related.length ? `Candidate verses:\n${related.map((h) => `V ${h.reference}: ${h.text}`).join("\n")}` : "",
    fatherHits.length
      ? `Church father candidates:\n${fatherHits
          .map((h, i) => `F${i + 1} ${h.author}${h.condemned ? " [condemned as heretical]" : ""}${h.work ? `, ${h.work}` : ""} (on ${h.passage}): ${clip(h.text, 500)}`)
          .join("\n")}`
      : "",
    confessionHits.length
      ? `Confession candidates:\n${confessionHits
          .map((h, i) => `C${i + 1} ${h.document} ${h.label ?? ""}: ${clip(h.text, 400)}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let parsed: Record<string, unknown> = {};
  try {
    const result = await env.AI.run(REFINE_MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Study notes:\n"""\n${text.slice(0, 4000)}\n"""\n\n${candidates}` },
      ],
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      max_tokens: 3000,
      temperature: 0.2,
    } as never);
    parsed = parseJson(parseWorkersAiText(result));
  } catch {
    // Fall through: retrieval results alone are still useful.
  }

  const pick = <H, R>(hits: H[], picks: Record<string, unknown>[], prefix: string, make: (hit: H, note: string) => R) => {
    const chosen: R[] = [];
    const used = new Set<number>();
    for (const p of picks) {
      const index = Number(str(p.id).replace(prefix, "")) - 1;
      const hit = hits[index];
      if (!hit || used.has(index)) continue;
      used.add(index);
      chosen.push(make(hit, str(p.note)));
    }
    // Model unavailable or picked nothing → show top retrieved results unannotated.
    return chosen.length ? chosen : hits.slice(0, 5).map((hit) => make(hit, ""));
  };

  const fathers = pick(fatherHits, arr(parsed.fathers), "F", (hit, note) => ({ ...hit, note }));
  const confessions = pick(confessionHits, arr(parsed.confessions), "C", (hit, note) => ({ ...hit, note }));

  let rawRefs = arr(parsed.crossReferences)
    .map((item) => ({ reference: str(item.reference), note: str(item.note) }))
    .filter((item) => item.reference);
  if (!rawRefs.length) rawRefs = related.slice(0, 6).map((hit) => ({ reference: hit.reference, note: "" }));

  // Ground cross-references in the BSB database so verse text is never model-generated.
  const crossReferences = await Promise.all(
    rawRefs.map(async ({ reference, note }): Promise<DeeperCrossReference> => {
      const ref = findBibleReferences(reference)[0];
      if (!ref || !db) return { reference, note, verified: false };
      const passage = await fetchPassageFromD1(db, ref.book.slug, ref.chapter, ref.verseStart, ref.verseEnd).catch(
        () => null,
      );
      if (!passage) return { reference: ref.label, note, verified: false };
      return { reference: passage.reference, note, text: passage.verses.map((v) => v.text).join(" "), verified: true };
    }),
  );

  const queries = Array.isArray(parsed.searchQueries) ? parsed.searchQueries.map(str) : [];
  if (!queries.length) queries.push(str(parsed.theme) || text.slice(0, 80));
  const furtherReading = await fetchFurtherReading(queries).catch(() => [] as ReadingItem[]);

  return { theme: str(parsed.theme), crossReferences, fathers, confessions, related, furtherReading };
}

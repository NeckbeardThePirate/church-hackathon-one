const REFORMED_DOC = /westminster|heidelberg|belgic|dort|canons/i;

const GENERIC = new Set(
  `god lord jesus christ faith sin man men holy church scripture lesson about this that with from into unto upon shall their there which when what your they them have been being also only just more most than then water spirit birth john chapter verse article question answer`.split(
    " ",
  ),
);

type Focus = {
  pattern: RegExp;
  strong: string[];
  refs: string[];
};

/**
 * Passage themes the library should prefer.
 * John 3 is the case that was pulling the fall and the mediator instead of new birth.
 */
const FOCI: Focus[] = [
  {
    pattern: /\bjohn\s+3\b|\bnicodemus\b|\bborn of water\b|\bnew birth\b|\bborn again\b|\bregeneration\b/i,
    strong: ["regeneration", "new birth", "born again", "holy spirit", "baptism"],
    refs: ["Ezekiel 36:25-27", "John 3:5", "John 3:8"],
  },
];

export type RetrievalFocus = {
  strong: string[];
  terms: string[];
  refs: string[];
};

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

function distinctiveWords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? [];
  return words.filter((word) => !GENERIC.has(word));
}

/** Strong terms, companion passages, and distinctive words from the lesson or question. */
export function retrievalFocus(text: string): RetrievalFocus {
  const strong: string[] = [];
  const refs: string[] = [];
  for (const focus of FOCI) {
    if (!focus.pattern.test(text)) continue;
    for (const term of focus.strong) {
      if (!strong.includes(term)) strong.push(term);
    }
    for (const ref of focus.refs) {
      if (!refs.includes(ref)) refs.push(ref);
    }
  }
  const terms = [...strong];
  for (const word of distinctiveWords(text)) {
    if (!terms.includes(word)) terms.push(word);
    if (terms.length >= 24) break;
  }
  return { strong, terms, refs };
}

function includesTerm(hay: string, term: string): boolean {
  return hay.includes(term.toLowerCase());
}

/**
 * A card is on topic when it shares a strong theme term, or two distinctive words.
 * One shared generic word is not enough, so an off-topic standard is dropped.
 */
export function citationRelevant(text: string, focus: RetrievalFocus): boolean {
  const hay = text.toLowerCase();
  if (focus.strong.some((term) => includesTerm(hay, term))) return true;
  const distinctive = focus.terms.filter((term) => !focus.strong.includes(term) && term.length >= 6 && !GENERIC.has(term));
  const hits = distinctive.filter((term) => includesTerm(hay, term));
  return hits.length >= 2;
}

function overlap(text: string, focus: RetrievalFocus): number {
  const hay = text.toLowerCase();
  let score = 0;
  for (const term of focus.strong) {
    if (includesTerm(hay, term)) score += 3;
  }
  for (const term of focus.terms) {
    if (focus.strong.includes(term)) continue;
    if (includesTerm(hay, term)) score += 1;
  }
  return score;
}

export function selectRelevant<T>(
  hits: T[],
  textOf: (hit: T) => string,
  focus: RetrievalFocus,
  options: {
    limit: number;
    perspective?: string;
    reformed?: (hit: T) => boolean;
    /** Verse-anchored commentaries and fathers may stay when they sit on the lesson passage. */
    keepAnyway?: (hit: T) => boolean;
  },
): T[] {
  const kept = hits.filter((hit) => options.keepAnyway?.(hit) === true || citationRelevant(textOf(hit), focus));
  kept.sort((a, b) => {
    const byOverlap = overlap(textOf(b), focus) - overlap(textOf(a), focus);
    if (byOverlap !== 0) return byOverlap;
    if (options.perspective === "Reformed" && options.reformed) {
      return Number(options.reformed(b)) - Number(options.reformed(a));
    }
    return 0;
  });
  return kept.slice(0, options.limit);
}

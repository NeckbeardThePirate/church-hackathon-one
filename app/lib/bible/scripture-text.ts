/** Normalize scripture plain text for fuzzy comparison (BSB vs user/OCR). */
export function normalizeScripturePlain(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+:\d+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordTokens(text: string): string[] {
  return normalizeScripturePlain(text).split(" ").filter((word) => word.length > 0);
}

/** Share of input words that appear in the candidate text (0–1). */
export function inputWordCoverage(input: string, candidate: string): number {
  const inputWords = wordTokens(input);
  if (inputWords.length === 0) return 0;
  const candidateWords = new Set(wordTokens(candidate));
  let hits = 0;
  for (const word of inputWords) {
    if (candidateWords.has(word)) hits += 1;
  }
  return hits / inputWords.length;
}

const MIN_INPUT_WORDS = 5;
const MIN_INPUT_CHARS = 24;
const MATCH_COVERAGE = 0.88;

export const PARTIAL_MIN_CHARS = 12;
export const PARTIAL_MIN_WORDS = 4;
const PARTIAL_COVERAGE = 0.82;

export type ScriptureOverlapOptions = {
  minChars?: number;
  minWords?: number;
  coverage?: number;
};

function normalizedSubstringMatch(a: string, b: string, minChars: number): boolean {
  const left = normalizeScripturePlain(a);
  const right = normalizeScripturePlain(b);
  if (!left || !right) return false;
  if (left.length >= minChars && right.includes(left)) return true;
  if (right.length >= minChars && left.includes(right)) return true;
  return false;
}

/** True when two strings are the same verse prose, a partial clip, or a multi-verse chunk overlap. */
export function scriptureTextsOverlap(
  textA: string,
  textB: string,
  opts: ScriptureOverlapOptions = {},
): boolean {
  const minChars = opts.minChars ?? PARTIAL_MIN_CHARS;
  const minWords = opts.minWords ?? PARTIAL_MIN_WORDS;
  const coverage = opts.coverage ?? PARTIAL_COVERAGE;

  const a = textA.trim();
  const b = textB.trim();
  if (!a || !b) return false;

  if (isLikelyVersePlainText(a, b) || isLikelyVersePlainText(b, a)) return true;
  if (normalizedSubstringMatch(a, b, minChars)) return true;

  const wordsA = wordTokens(a);
  const wordsB = wordTokens(b);
  if (wordsA.length >= minWords && inputWordCoverage(a, b) >= coverage) return true;
  if (wordsB.length >= minWords && inputWordCoverage(b, a) >= coverage) return true;

  return false;
}

export function isLikelyVersePlainText(input: string, candidate: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < MIN_INPUT_CHARS) return false;

  const inputNorm = normalizeScripturePlain(trimmed);
  const candidateNorm = normalizeScripturePlain(candidate);
  if (!inputNorm || !candidateNorm) return false;

  if (inputNorm === candidateNorm) return true;
  if (inputNorm.length >= MIN_INPUT_CHARS && candidateNorm.includes(inputNorm)) return true;
  if (candidateNorm.length >= MIN_INPUT_CHARS && inputNorm.includes(candidateNorm)) return true;

  const words = wordTokens(trimmed);
  if (words.length < MIN_INPUT_WORDS) return false;
  return inputWordCoverage(trimmed, candidate) >= MATCH_COVERAGE;
}

export type VerseTextSlice = { text: string };

/** Every contiguous combined span within a verse list (single verses and multi-verse chunks). */
export function contiguousVersePassageTexts(verses: VerseTextSlice[]): string[] {
  const spans: string[] = [];
  for (let start = 0; start < verses.length; start++) {
    let combined = "";
    for (let end = start; end < verses.length; end++) {
      const piece = verses[end]!.text.trim();
      if (!piece) continue;
      combined = combined ? `${combined} ${piece}` : piece;
      spans.push(combined);
    }
  }
  return spans;
}

export function blockOverlapsVerseText(blockPlain: string, verseText: string): boolean {
  return scriptureTextsOverlap(blockPlain, verseText);
}

/**
 * Whether block prose already shows this passage — full text, a partial verse clip,
 * or any contiguous multi-verse chunk from the passage.
 */
export function passageContentAlreadyPresent(
  blockPlain: string,
  passagePlain: string,
  verses?: VerseTextSlice[],
): boolean {
  const plain = blockPlain.trim();
  if (!plain) return false;

  if (scriptureTextsOverlap(plain, passagePlain)) return true;

  if (verses?.length) {
    for (const span of contiguousVersePassageTexts(verses)) {
      if (scriptureTextsOverlap(plain, span)) return true;
    }
    if (verses.length > 1 && verses.every((row) => blockOverlapsVerseText(plain, row.text))) {
      return true;
    }
  }

  return false;
}

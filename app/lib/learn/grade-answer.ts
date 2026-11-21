/** Semantic short-answer grading. Meaning counts; wording does not. */

export type GradeResult = {
  /** Substantively correct, including a paraphrase of the key ideas. */
  correct: boolean;
  /** Some key concepts are present, but an important part is missing. */
  partial: boolean;
  /** 0–1. Partial credit lives between the wrong and correct bands. */
  score: number;
};

export type GradeInput = {
  question: string;
  expected: string;
  given: string;
  rationale?: string;
};

const STOP = new Set(
  `a an the of to in on for and or that this it is be as with by from at into within often goes go than its their your you we they are was were been being not no nor but if so such very just only also about into over under`.split(
    " ",
  ),
);

/** Words that modify a real concept and should not become their own concept. */
const GENERIC = new Set("based often goes within shown show into from with about when where which while than then also very more most such only just like even".split(" "));

/**
 * Synonym clusters. The first word is the concept id.
 * A learner hits the concept by using any word in the cluster.
 */
const CLUSTERS: string[][] = [
  ["faithful", "faithfulness", "loyal", "loyalty", "steadfast", "steadfastness", "fidelity", "hesed", "faith"],
  ["covenant", "covenantal", "treaty", "bond", "relationship", "relational", "promise", "oath", "pledge"],
  ["kindness", "kind", "mercy", "merciful", "love", "loving", "grace", "goodness", "compassion"],
  ["action", "act", "acts", "practice", "shown", "show", "deed", "deeds", "behavior", "behaviour"],
  ["obligation", "duty", "duties", "required", "requirement", "strict", "law", "legal", "owed"],
  ["beyond", "extra", "exceeds", "surpasses", "above", "past"],
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stem(word: string): string {
  return word.replace(/(ingly|ness|ment|tions|tion|ing|ed|ly|es|s)$/, "");
}

function clusterId(word: string): string | null {
  const token = word.toLowerCase();
  const stemmed = stem(token);
  for (const group of CLUSTERS) {
    if (group.some((item) => item === token || item === stemmed || stem(item) === stemmed)) return group[0]!;
  }
  if (STOP.has(token) || GENERIC.has(token)) return null;
  if (stemmed.length < 4) return null;
  return stemmed;
}

/** Concept ids in the order they appear. Duplicates collapse. */
export function conceptIds(text: string): string[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const id = clusterId(word);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score));
}

/**
 * Judge a short answer against the expected key.
 * Accepts a paraphrase that carries the main concepts. A single shared word is not enough.
 */
export function gradeShortAnswerLocal(given: string, expected: string): GradeResult {
  const learner = given.trim();
  const key = expected.trim();
  if (!learner || !key) return { correct: false, partial: false, score: 0 };

  const learnerNorm = normalize(learner);
  const keyNorm = normalize(key);
  if (learnerNorm === keyNorm) return { correct: true, partial: false, score: 1 };
  if (learnerNorm.length >= 12 && (keyNorm.includes(learnerNorm) || learnerNorm.includes(keyNorm))) {
    return { correct: true, partial: false, score: 0.92 };
  }

  const expectedIds = conceptIds(key);
  const givenIds = new Set(conceptIds(learner));
  if (!expectedIds.length) return { correct: false, partial: false, score: 0 };

  let hits = 0;
  for (const id of expectedIds) {
    if (givenIds.has(id)) hits += 1;
  }
  const recall = hits / expectedIds.length;
  const head = expectedIds.slice(0, Math.min(3, expectedIds.length));
  const headHits = head.filter((id) => givenIds.has(id)).length;
  const headNeeded = expectedIds.length <= 2 ? head.length : Math.min(2, head.length);

  const correct = expectedIds.length <= 2 ? recall >= 0.5 : recall >= 0.55 && headHits >= headNeeded;
  const partial = !correct && (recall >= 0.34 || headHits >= 1);
  const score = correct ? Math.max(recall, 0.8) : recall;
  return { correct, partial, score: clampScore(score) };
}

/** Model JSON: `{ score, correct, partial }`. Throws when the object is not a grade. */
export function parseGradeModel(value: unknown): GradeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("grade must be an object");
  const row = value as Record<string, unknown>;
  const rawScore = typeof row.score === "number" ? row.score : Number(row.score);
  if (!Number.isFinite(rawScore)) throw new Error("score must be a number");
  const score = clampScore(rawScore);
  const saidCorrect = row.correct === true;
  const correct = saidCorrect || score >= 0.75;
  const partial = !correct && (row.partial === true || score >= 0.4);
  return { correct, partial, score: correct ? Math.max(score, 0.75) : score };
}

export const GRADE_SYSTEM = `You grade one short study answer. Judge meaning, not wording.
Accept a paraphrase or an answer that includes the key concepts even when none of the expected phrases appear.
Secondary details may be missing and the answer can still be correct.
Reject an answer that misses the main idea or asserts something different.
Return only JSON: {"score": number from 0 to 1, "correct": boolean, "partial": boolean}.
correct is true when the answer is substantively right.
partial is true only when correct is false and at least one key concept is present.`;

export function gradeUserPrompt(input: GradeInput): string {
  const lines = [
    `Question: ${input.question.trim()}`,
    `Expected answer: ${input.expected.trim()}`,
    `Learner answer: ${input.given.trim()}`,
  ];
  if (input.rationale?.trim()) lines.push(`Why the expected answer is right: ${input.rationale.trim()}`);
  return lines.join("\n");
}

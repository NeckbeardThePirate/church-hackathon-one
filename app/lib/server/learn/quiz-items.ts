/**
 * Quiz item parser for teach, check, and assemble.
 * Newly generated lesson quizzes are tagged. Items saved before concept tags stay valid.
 *
 * Choice order is applied once, in code, when a generated quiz is finalized.
 * Parsing leaves choices as the model wrote them, so a stored quiz is not
 * shuffled again on load, render, or grade. Grading compares the choice text
 * to `answer`, not a slot index.
 */
import { CONCEPT_ID } from "../../learn/attempts.ts";
import type { QuizItem } from "../../learn/types.ts";
import { list, num, obj, str, strList } from "./llm.ts";
import { SOURCE_TEXT_RULE } from "./source-policy.ts";

const LABEL_MAX = 200;

export type QuizParseOptions = {
  /** Teach-time output must carry conceptId and conceptLabel. Check and final assessment stay lenient. */
  strictConcepts?: boolean;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** Rules added to the runTeach prompt. References only: this string must not contain verse text. */
export function teachConceptRules(lessonOrder: number): string {
  const example = `l${lessonOrder}-justification`;
  return `Each quiz item must include conceptId and conceptLabel.
conceptId is a stable slug (letters, digits, and hyphens), usually "l${lessonOrder}-<idea>" (for example "${example}").
Use few concepts. A concept usually matches one lesson objective: set objectiveIndex to that objective, and items that test the same objective share one conceptId.
conceptLabel is a short human name for that concept.
For each conceptId, put "alternate" on exactly one item for that concept. The alternate is a second question with the same conceptId, conceptLabel, and objectiveIndex, and it must not contain its own alternate.
The alternate follows the same quiz rules and must be answerable from the lesson text alone.
${SOURCE_TEXT_RULE}`;
}

/**
 * Rules for every generated quiz. Choice order is not the model's job:
 * {@link finalizeGeneratedQuiz} shuffles after this text is satisfied.
 */
export function quizGenerationRules(): string {
  return `Quiz rules: the only supported kinds are multiple choice ("mc") and short answer ("short"). Use both.
Multiple choice items have exactly 4 choices, and "answer" must exactly equal one choice. Do not place the correct choice in a preferred slot. The app shuffles choices in code and keeps the answer text on the choice it moves.
Short-answer items have a one-sentence answer and no choices.
Mix the kinds across the quiz. For 2 items, use one of each. For 3 items, include at least one of each. For 4 or more, at least 40% of the items must be short answer and at least 40% must be multiple choice. A quiz that is almost all multiple choice is invalid.
When an item has an alternate, use the other kind for that alternate when the lesson supports it, so review is not all multiple choice.
Every item must be answerable from the lesson text alone.
objectiveIndex is the 0-based index of the lesson objective the item tests.`;
}

/** Rewrite prompt: same count and kind as the failed items, then the shared quiz rules. */
export function rewrittenQuizRules(count: number): string {
  return `Return exactly ${count} items, in the same order. Keep each rewritten item's kind ("mc" or "short") the same as the failed item it replaces.
${quizGenerationRules()}`;
}

/**
 * How many items of each supported kind a generated quiz must include.
 * Two items: one of each. Three: at least one of each.
 * Four or more: at least 40% of each kind.
 */
export function quizKindMinimum(count: number): number {
  if (count < 2) return 0;
  if (count < 4) return 1;
  return Math.ceil(count * 0.4);
}

/** Reject a generated quiz that is almost entirely one kind. */
export function assertQuizKindMix(items: readonly QuizItem[], path = "quiz"): void {
  const minimum = quizKindMinimum(items.length);
  if (minimum === 0) return;
  let multipleChoice = 0;
  let shortAnswer = 0;
  for (const item of items) {
    if (item.kind === "short") shortAnswer += 1;
    else multipleChoice += 1;
  }
  if (multipleChoice >= minimum && shortAnswer >= minimum) return;
  throw new Error(
    `${path} needs a mix of question types (${multipleChoice} multiple choice, ${shortAnswer} short answer). ` +
      `Include at least ${minimum} multiple choice and ${minimum} short answer.`,
  );
}

/** A check rewrite replaces questions. It must not change how many there are or their kinds. */
export function assertRewrittenKinds(previous: readonly QuizItem[], next: readonly QuizItem[]): void {
  if (next.length !== previous.length) {
    throw new Error(`quiz must include exactly ${previous.length} items`);
  }
  next.forEach((item, index) => {
    const before = previous[index];
    if (before && item.kind !== before.kind) {
      throw new Error(`quiz[${index}] must stay kind "${before.kind}"`);
    }
  });
}

/**
 * Shuffle multiple-choice options once and spread the correct choice across slots.
 * The returned items are new objects. `answer` stays the same string, and that
 * string is placed at slot `ordinal % choiceCount` so a quiz is not stuck on one index.
 * Calling this again with the same seed returns the same order.
 */
export function shuffleQuizChoices(items: readonly QuizItem[], seed = "quiz"): QuizItem[] {
  let slot = 0;
  const takeSlot = () => slot++;
  return items.map((item, index) => arrangeItem(item, `${seed}:${index}`, takeSlot));
}

/** Check the kind mix, then shuffle. Used when a full quiz is stored. */
export function finalizeGeneratedQuiz(items: readonly QuizItem[], seed: string): QuizItem[] {
  assertQuizKindMix(items);
  return shuffleQuizChoices(items, seed);
}

/** Keep rewrite kinds, then shuffle the new choice lists. */
export function finalizeRewrittenQuiz(previous: readonly QuizItem[], next: readonly QuizItem[], seed: string): QuizItem[] {
  assertRewrittenKinds(previous, next);
  return shuffleQuizChoices(next, seed);
}

export function parseQuizItems(
  value: unknown,
  path: string,
  objectiveCount: number,
  options: QuizParseOptions = {},
): QuizItem[] {
  return list(value, path).map((item, index) =>
    parseQuizItem(item, `${path}[${index}]`, objectiveCount, options, false),
  );
}

/**
 * A check rewrite replaces the question. The concept and its alternate were chosen at teach time,
 * so they stay with the item even if the rewrite omits them or invents a new slug.
 */
export function carryConceptTags(from: QuizItem | undefined, to: QuizItem): QuizItem {
  if (!from?.conceptId) return to;
  return {
    ...to,
    conceptId: from.conceptId,
    ...(from.conceptLabel ? { conceptLabel: from.conceptLabel } : {}),
    ...(from.alternate ? { alternate: from.alternate } : {}),
  };
}

/** Teach-time gate: every item is tagged, and every concept has an alternate somewhere in the quiz. */
export function requireConceptTags(items: QuizItem[]): void {
  items.forEach((item, index) => {
    if (!item.conceptId || !item.conceptLabel) {
      throw new Error(`quiz[${index}] must include conceptId and conceptLabel`);
    }
  });
  const covered = new Set<string>();
  for (const item of items) {
    if (item.conceptId && item.alternate?.conceptId === item.conceptId) covered.add(item.conceptId);
  }
  const missing: string[] = [];
  for (const item of items) {
    if (item.conceptId && !covered.has(item.conceptId) && !missing.includes(item.conceptId)) {
      missing.push(item.conceptId);
    }
  }
  if (missing.length) {
    throw new Error(`Each concept needs one alternate question. Missing alternate for: ${missing.join(", ")}`);
  }
}

function parseQuizItem(
  value: unknown,
  path: string,
  objectiveCount: number,
  options: QuizParseOptions,
  nested: boolean,
): QuizItem {
  const record = obj(value, path);
  const kind = record.kind === "short" ? "short" : "mc";
  const question = str(record.question, `${path}.question`);
  const answer = str(record.answer, `${path}.answer`);
  const rationale = str(record.rationale, `${path}.rationale`, { optional: true });
  const objectiveIndex = clamp(num(record.objectiveIndex, 0), 0, Math.max(0, objectiveCount - 1));
  const concept = readConcept(record, path, options.strictConcepts === true && !nested);
  const item: QuizItem =
    kind === "mc"
      ? {
          kind,
          question,
          choices: mcChoices(record, path, answer),
          answer,
          rationale,
          objectiveIndex,
          ...concept,
        }
      : { kind, question, answer, rationale, objectiveIndex, ...concept };
  if (nested) return item;
  const alternate = readAlternate(record.alternate, `${path}.alternate`, objectiveCount, options, item.conceptId, item.conceptLabel);
  return alternate ? { ...item, alternate } : item;
}

function mcChoices(record: Record<string, unknown>, path: string, answer: string): string[] {
  const choices = strList(record.choices, `${path}.choices`, { min: 2 }).slice(0, 5);
  if (!choices.includes(answer)) throw new Error(`${path}: answer must exactly equal one of the choices`);
  return choices;
}

function arrangeItem(item: QuizItem, seed: string, takeSlot: () => number): QuizItem {
  const choices = arrangedChoices(item, seed, takeSlot);
  const alternate = item.alternate ? arrangeAlternate(item.alternate, `${seed}:alternate`, takeSlot) : undefined;
  return {
    ...item,
    ...(choices ? { choices } : {}),
    ...(alternate ? { alternate } : {}),
  };
}

function arrangeAlternate(
  alternate: NonNullable<QuizItem["alternate"]>,
  seed: string,
  takeSlot: () => number,
): NonNullable<QuizItem["alternate"]> {
  const choices = arrangedChoices(alternate, seed, takeSlot);
  return choices ? { ...alternate, choices } : alternate;
}

function arrangedChoices(
  item: { kind: QuizItem["kind"]; question: string; choices?: string[]; answer: string },
  seed: string,
  takeSlot: () => number,
): string[] | undefined {
  const choices = item.choices;
  if (item.kind !== "mc" || !choices || choices.length < 2) return undefined;
  const correctAt = choices.indexOf(item.answer);
  if (correctAt < 0) return undefined;
  return placeAnswer(choices, correctAt, `${seed}\n${item.question}`, takeSlot());
}

/**
 * Distractors are sorted before the shuffle so a second call sees the same
 * input even after the correct choice has moved. The correct string is then
 * written into `slot`. Grading still compares that string, not the slot.
 */
function placeAnswer(choices: readonly string[], correctAt: number, seed: string, slot: number): string[] {
  const answer = choices[correctAt] ?? "";
  const distractors = choices.filter((_, index) => index !== correctAt).sort(byCodePoint);
  const shuffled = fisherYates(distractors, mulberry32(hashString(`${seed}\n${answer}\n${distractors.join("\u0001")}`)));
  const target = slot % choices.length;
  const next: string[] = [];
  let distractor = 0;
  for (let index = 0; index < choices.length; index++) {
    next.push(index === target ? answer : (shuffled[distractor++] ?? ""));
  }
  return next;
}

function byCodePoint(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function fisherYates<T>(items: readonly T[], random: () => number): T[] {
  const next = items.slice();
  for (let index = next.length - 1; index > 0; index--) {
    const swapAt = Math.floor(random() * (index + 1));
    const swap = next[index]!;
    next[index] = next[swapAt]!;
    next[swapAt] = swap;
  }
  return next;
}

function readConcept(
  record: Record<string, unknown>,
  path: string,
  strict: boolean,
): Pick<QuizItem, "conceptId" | "conceptLabel"> {
  const rawId = record.conceptId;
  const blank = rawId == null || (typeof rawId === "string" && rawId.trim() === "");
  if (blank) {
    if (strict) throw new Error(`${path} must include conceptId and conceptLabel`);
    return {};
  }
  if (typeof rawId !== "string" || !CONCEPT_ID.test(rawId.trim())) {
    if (strict) throw new Error(`${path}.conceptId must be a short slug`);
    return {};
  }
  const conceptId = rawId.trim();
  const rawLabel = record.conceptLabel;
  if (typeof rawLabel !== "string" || !rawLabel.trim()) {
    if (strict) throw new Error(`${path} must include conceptLabel`);
    return { conceptId };
  }
  const conceptLabel = rawLabel.trim();
  if (conceptLabel.length > LABEL_MAX) {
    if (strict) throw new Error(`${path}.conceptLabel must be a short string`);
    return { conceptId, conceptLabel: conceptLabel.slice(0, LABEL_MAX) };
  }
  return { conceptId, conceptLabel };
}

function readAlternate(
  value: unknown,
  path: string,
  objectiveCount: number,
  options: QuizParseOptions,
  conceptId: string | undefined,
  conceptLabel: string | undefined,
): QuizItem["alternate"] | undefined {
  if (value == null) return undefined;
  if (!conceptId) {
    if (options.strictConcepts) throw new Error(`${path} requires conceptId on the quiz item`);
    return undefined;
  }
  let parsed: QuizItem;
  try {
    parsed = parseQuizItem(value, path, objectiveCount, { strictConcepts: false }, true);
  } catch (error) {
    if (options.strictConcepts) throw error;
    return undefined;
  }
  if (parsed.conceptId && parsed.conceptId !== conceptId && options.strictConcepts) {
    throw new Error(`${path}.conceptId must match the item conceptId`);
  }
  return {
    kind: parsed.kind,
    question: parsed.question,
    ...(parsed.choices ? { choices: parsed.choices } : {}),
    answer: parsed.answer,
    rationale: parsed.rationale,
    objectiveIndex: parsed.objectiveIndex,
    conceptId,
    ...(conceptLabel ? { conceptLabel } : {}),
  };
}

/**
 * Quiz item parser for teach, check, and assemble.
 * Newly generated lesson quizzes are tagged. Items saved before concept tags stay valid.
 */
import { CONCEPT_ID } from "../../learn/attempts.ts";
import type { QuizItem } from "../../learn/types.ts";
import { list, num, obj, str, strList } from "./llm.ts";

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
Do not write Bible verse text, confession text, or father quotations. scriptureRefs are references only; verified wording is inserted later from the library.`;
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

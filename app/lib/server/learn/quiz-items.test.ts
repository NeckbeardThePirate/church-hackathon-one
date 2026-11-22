import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockModelText } from "./mock-llm.ts";
import { carryConceptTags, parseQuizItems, requireConceptTags, teachConceptRules } from "./quiz-items.ts";
import type { QuizItem } from "../../learn/types.ts";

const legacy: QuizItem = {
  kind: "mc",
  question: "What justifies?",
  choices: ["Faith", "Works"],
  answer: "Faith",
  rationale: "The lesson says faith.",
  objectiveIndex: 0,
};

function tagged(over: Partial<QuizItem> = {}): QuizItem {
  return {
    kind: "short",
    question: "What receives the gift?",
    answer: "Faith.",
    rationale: "The lesson says faith receives a gift.",
    objectiveIndex: 0,
    conceptId: "l2-justification",
    conceptLabel: "Justification",
    ...over,
  };
}

function alternate(conceptId = "l2-justification", conceptLabel = "Justification"): NonNullable<QuizItem["alternate"]> {
  return {
    kind: "mc",
    question: "Which word names how a person is made right?",
    choices: ["Justification", "Pride"],
    answer: "Justification",
    rationale: "The objective is justification.",
    objectiveIndex: 0,
    conceptId,
    conceptLabel,
  };
}

test("the teach prompt asks for stable concepts and does not invent scripture text", () => {
  const rules = teachConceptRules(2);
  assert.match(rules, /conceptId/);
  assert.match(rules, /conceptLabel/);
  assert.match(rules, /alternate/);
  assert.match(rules, /l2-justification/);
  assert.match(rules, /references only/);
  assert.match(rules, /Do not write Bible verse text/);
  assert.doesNotMatch(rules, /For God so loved|In the beginning God|the wages of sin/);
  const stages = readFileSync(new URL("./stages.ts", import.meta.url), "utf8");
  assert.match(stages, /teachConceptRules\(lesson\.order\)/);
  assert.match(stages, /Never quote Bible verse text/);
  assert.match(stages, /strictConcepts: true/);
});

test("a tagged quiz item keeps its concept and one alternate, including a shared concept", () => {
  const items = parseQuizItems(
    [
      tagged(),
      tagged({
        question: "Name the doctrine.",
        alternate: alternate(),
      }),
      tagged({
        conceptId: "l2-faith",
        conceptLabel: "Faith",
        question: "What receives the gift?",
        alternate: {
          kind: "short",
          question: "Restate faith.",
          answer: "Faith receives a gift.",
          rationale: "The lesson says faith receives a gift.",
          objectiveIndex: 0,
          conceptId: "l2-faith",
          conceptLabel: "Faith",
        },
      }),
    ],
    "quiz",
    2,
    { strictConcepts: true },
  );
  assert.equal(items[1]?.alternate?.conceptId, "l2-justification");
  assert.equal(items[1]?.alternate?.conceptLabel, "Justification");
  assert.equal(items[1]?.alternate && "alternate" in items[1].alternate, false);
  requireConceptTags(items);
  assert.equal(items[2]?.alternate?.conceptId, "l2-faith");
  assert.equal(items[2]?.alternate?.conceptLabel, "Faith");
});

test("untagged legacy items still parse, and a bad slug does not reject the question", () => {
  const items = parseQuizItems(
    [legacy, { ...legacy, question: "Again?", conceptId: "not a slug!", conceptLabel: "Nope", alternate: alternate() }],
    "quiz",
    1,
  );
  assert.equal(items[0]?.conceptId, undefined);
  assert.equal(items[0]?.alternate, undefined);
  assert.equal(items[0]?.answer, "Faith");
  assert.equal(items[1]?.conceptId, undefined);
  assert.equal(items[1]?.question, "Again?");
  assert.equal(items[1]?.alternate, undefined);
  assert.throws(() => parseQuizItems([legacy], "quiz", 1, { strictConcepts: true }), /conceptId/);
});

test("teach-time quizzes require an alternate per concept and reject a mismatched alternate id", () => {
  const missing = parseQuizItems([tagged(), tagged({ conceptId: "l2-faith", conceptLabel: "Faith" })], "quiz", 1);
  assert.throws(() => requireConceptTags(missing), /l2-justification/);
  assert.throws(
    () =>
      parseQuizItems([tagged({ alternate: alternate("l2-other", "Other") })], "quiz", 1, { strictConcepts: true }),
    /conceptId/,
  );
  const lenient = parseQuizItems([tagged({ alternate: alternate("l2-other", "Other") })], "quiz", 1);
  assert.equal(lenient[0]?.alternate?.conceptId, "l2-justification");
});

test("a check rewrite keeps the teach-time concept when the new question is untagged", () => {
  const from = tagged({ alternate: alternate() });
  const rewritten = carryConceptTags(from, {
    ...legacy,
    question: "Clearer question?",
    conceptId: "invented",
    conceptLabel: "Invented",
  });
  assert.equal(rewritten.question, "Clearer question?");
  assert.equal(rewritten.conceptId, "l2-justification");
  assert.equal(rewritten.conceptLabel, "Justification");
  assert.equal(rewritten.alternate?.question, alternate().question);
  const legacyRewrite = carryConceptTags(legacy, { ...legacy, question: "Still legacy?" });
  assert.equal(legacyRewrite.conceptId, undefined);
  assert.equal(legacyRewrite.question, "Still legacy?");
});

test("MOCK_AI teach output is a tagged quiz the lesson checker can still answer", () => {
  const text = mockModelText("You write one lesson", "Topic: faith in Romans\nLesson 1", {
    planId: "plan-1",
    stage: "teach",
    lessonId: "l1",
  });
  const body = JSON.parse(text) as { quiz: unknown; scriptureRefs: { reference: string }[] };
  const quiz = parseQuizItems(body.quiz, "quiz", 2, { strictConcepts: true });
  requireConceptTags(quiz);
  assert.equal(quiz.length, 3);
  assert.equal(quiz[0]?.answer, "Faith");
  assert.equal(quiz[1]?.answer, "Romans");
  assert.equal(quiz[2]?.answer, "Faith receives a gift.");
  assert.equal(quiz[0]?.alternate?.conceptId, "l1-gift");
  assert.equal(body.scriptureRefs[0]?.reference, "Romans 3:21-26");
  assert.equal(JSON.stringify(body).includes("For all have sinned"), false);

  const check = JSON.parse(
    mockModelText("You are a student", "Questions", { planId: "plan-1", stage: "check", lessonId: "l1" }),
  ) as { answers: { answer: string }[] };
  assert.equal(check.answers[0]?.answer, "Faith");
  assert.equal(check.answers[1]?.answer, "Romans");
  assert.equal(check.answers[2]?.answer, "Faith receives a gift.");
});

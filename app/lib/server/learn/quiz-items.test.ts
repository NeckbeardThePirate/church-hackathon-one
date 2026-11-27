import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mockModelText } from "./mock-llm.ts";
import {
  assertQuizKindMix,
  assertRewrittenKinds,
  carryConceptTags,
  finalizeGeneratedQuiz,
  finalizeRewrittenQuiz,
  parseQuizItems,
  quizGenerationRules,
  quizKindMinimum,
  requireConceptTags,
  rewrittenQuizRules,
  shuffleQuizChoices,
  teachConceptRules,
} from "./quiz-items.ts";
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
  assert.match(stages, /SOURCE_TEXT_RULE/);
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
  const body = JSON.parse(text) as {
    quiz: unknown;
    scriptureRefs: { reference: string }[];
    libraryRefs: { reference: string; note?: string }[];
  };
  const quiz = parseQuizItems(body.quiz, "quiz", 2, { strictConcepts: true });
  requireConceptTags(quiz);
  assert.equal(quiz.length, 3);
  assert.equal(quiz[0]?.answer, "Faith");
  assert.equal(quiz[1]?.answer, "Romans");
  assert.equal(quiz[2]?.answer, "Faith receives a gift.");
  assert.equal(quiz[0]?.alternate?.conceptId, "l1-gift");
  assert.equal(body.scriptureRefs[0]?.reference, "Romans 3:21-26");
  assert.equal(body.libraryRefs[0]?.reference, "Westminster Confession of Faith 11.1");
  assert.equal(JSON.stringify(body).includes("For all have sinned"), false);
  assert.equal(JSON.stringify(body).includes("Those whom God effectually"), false);

  const check = JSON.parse(
    mockModelText("You are a student", "Questions", { planId: "plan-1", stage: "check", lessonId: "l1" }),
  ) as { answers: { answer: string }[] };
  assert.equal(check.answers[0]?.answer, "Faith");
  assert.equal(check.answers[1]?.answer, "Romans");
  assert.equal(check.answers[2]?.answer, "Faith receives a gift.");

  // The fixture copies the model's habit of putting the key in slot 2. Parsing keeps that.
  // Finalizing is what moves it, and the saved choice text still matches `answer`.
  assert.equal(quiz[0]?.choices?.indexOf("Faith"), 1);
  assert.equal(quiz[1]?.choices?.indexOf("Romans"), 1);
  const finalized = finalizeGeneratedQuiz(quiz, "teach:l1");
  assert.deepEqual(
    finalized.filter((item) => item.kind === "mc").map((item) => item.choices?.indexOf(item.answer)),
    [0, 1],
  );
  assert.equal(finalized[0]?.answer, "Faith");
  assert.equal(gradeChoice("Faith", finalized[0]!), true);
  assert.equal(gradeChoice("Works", finalized[0]!), false);
  assert.equal(finalized[2]?.kind, "short");
  assert.equal(finalized[2]?.answer, "Faith receives a gift.");
  assert.deepEqual(quiz[0]?.choices, ["Works", "Faith", "Law", "Pride"]);
});

test("the quiz prompt requires both supported kinds and leaves slot order to code", () => {
  const rules = quizGenerationRules();
  assert.match(rules, /"mc"/);
  assert.match(rules, /"short"/);
  assert.match(rules, /at least 40%/);
  assert.match(rules, /one of each/);
  assert.match(rules, /shuffles choices in code/);
  assert.doesNotMatch(rules, /For God so loved|In the beginning God|the wages of sin/);
  assert.match(rewrittenQuizRules(2), /must stay kind|same as the failed item/);
  const stages = readFileSync(new URL("./stages.ts", import.meta.url), "utf8");
  assert.match(stages, /quizGenerationRules\(\)/);
  assert.match(stages, /finalizeGeneratedQuiz\(/);
  assert.match(stages, /finalizeRewrittenQuiz\(/);
  assert.equal(quizKindMinimum(1), 0);
  assert.equal(quizKindMinimum(2), 1);
  assert.equal(quizKindMinimum(3), 1);
  assert.equal(quizKindMinimum(4), 2);
  assert.equal(quizKindMinimum(5), 2);
  assert.equal(quizKindMinimum(8), 4);
  assert.equal(quizKindMinimum(10), 4);
});

test("a generated quiz must mix multiple choice and short answer", () => {
  assert.throws(() => assertQuizKindMix([mc("Only"), mc("Again")]), /at least 1/);
  assert.throws(() => assertQuizKindMix([shortItem("Only"), shortItem("Again")]), /multiple choice/);
  assert.throws(() => assertQuizKindMix([mc("A"), mc("B"), mc("C"), mc("D"), shortItem("E")]), /at least 2/);
  assert.doesNotThrow(() => assertQuizKindMix([mc("A"), mc("B"), shortItem("C")]));
  assert.doesNotThrow(() => assertQuizKindMix([mc("A"), mc("B"), mc("C"), shortItem("D"), shortItem("E")]));
  assert.doesNotThrow(() => assertQuizKindMix([mc("Alone")]));
  assert.throws(() => finalizeGeneratedQuiz([mc("A"), mc("B"), mc("C"), mc("D")], "seed"), /mix of question types/);
});

test("a rewrite keeps each item's kind and still remaps the new choices", () => {
  const previous = [mc("First"), shortItem("Second")];
  assert.throws(() => assertRewrittenKinds(previous, [mc("First")]), /exactly 2/);
  assert.throws(() => finalizeRewrittenQuiz(previous, [shortItem("First"), shortItem("Second")], "rewrite"), /kind "mc"/);
  const next = finalizeRewrittenQuiz(
    previous,
    [mc("Clearer first?"), shortItem("Clearer second?")],
    "rewrite",
  );
  assert.equal(next[0]?.kind, "mc");
  assert.equal(next[0]?.choices?.indexOf("B"), 0);
  assert.equal(next[0]?.answer, "B");
  assert.equal(next[1]?.kind, "short");
  assert.equal(next[1]?.answer, "Because.");
  assert.equal(next[1]?.choices, undefined);
});

test("seeded shuffling preserves the correct choice text and spreads its slot", () => {
  const stuck = ["One", "Two", "Three", "Four", "Five", "Six"].map((question) => mc(question));
  const original = stuck.map((item) => item.choices?.slice());
  const arranged = shuffleQuizChoices(stuck, "lesson-1");
  assert.deepEqual(
    arranged.map((item) => item.choices?.indexOf(item.answer)),
    [0, 1, 2, 3, 0, 1],
  );
  assert.ok(arranged.some((item) => item.choices?.indexOf(item.answer) !== 1));
  arranged.forEach((item, index) => {
    assert.equal(item.answer, "B");
    assert.deepEqual(item.choices?.slice().sort(), ["A", "B", "C", "D"]);
    assert.equal(gradeChoice("B", item), true);
    assert.equal(gradeChoice("A", item), false);
    assert.deepEqual(stuck[index]?.choices, original[index]);
  });
  assert.deepEqual(shuffleQuizChoices(arranged, "lesson-1"), arranged);
  const otherSeed = shuffleQuizChoices(stuck, "lesson-2");
  assert.deepEqual(
    otherSeed.map((item) => item.choices?.indexOf(item.answer)),
    arranged.map((item) => item.choices?.indexOf(item.answer)),
  );

  const mixed = shuffleQuizChoices([mc("Before"), shortItem("Middle"), mc("After")], "mixed");
  assert.equal(mixed[0]?.choices?.indexOf("B"), 0);
  assert.equal(mixed[1]?.kind, "short");
  assert.equal(mixed[1]?.choices, undefined);
  assert.equal(mixed[2]?.choices?.indexOf("B"), 1);

  const duplicated = shuffleQuizChoices(
    [{ ...mc("Dup"), choices: ["B", "A", "B", "C"] }],
    "dup",
  );
  assert.equal(duplicated[0]?.answer, "B");
  assert.equal(duplicated[0]?.choices?.[0], "B");
  assert.deepEqual(duplicated[0]?.choices?.slice().sort(), ["A", "B", "B", "C"]);
});

test("multiple-choice alternates take their own slots and keep the same answer text", () => {
  const items = ["One", "Two", "Three", "Four"].map((question) => {
    const item = mc(question);
    return { ...item, alternate: { ...item, question: `${question} alternate` } };
  });
  const arranged = shuffleQuizChoices(items, "alternates");
  assert.deepEqual(
    arranged.map((item) => item.choices?.indexOf(item.answer)),
    [0, 2, 0, 2],
  );
  assert.deepEqual(
    arranged.map((item) => item.alternate?.choices?.indexOf(item.alternate.answer)),
    [1, 3, 1, 3],
  );
  arranged.forEach((item) => {
    assert.equal(item.alternate?.answer, "B");
    assert.deepEqual(item.alternate?.choices?.slice().sort(), ["A", "B", "C", "D"]);
    assert.notEqual(item.choices?.indexOf(item.answer), item.alternate?.choices?.indexOf(item.alternate.answer));
  });
  assert.deepEqual(shuffleQuizChoices(arranged, "alternates"), arranged);
});

function gradeChoice(choice: string, item: QuizItem): boolean {
  const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(choice) === norm(item.answer);
}

function mc(question: string): QuizItem {
  return {
    kind: "mc",
    question,
    choices: ["A", "B", "C", "D"],
    answer: "B",
    rationale: "The key is B.",
    objectiveIndex: 0,
  };
}

function shortItem(question: string): QuizItem {
  return {
    kind: "short",
    question,
    answer: "Because.",
    rationale: "The lesson says because.",
    objectiveIndex: 0,
  };
}

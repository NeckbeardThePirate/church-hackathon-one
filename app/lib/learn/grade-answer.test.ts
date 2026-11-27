import assert from "node:assert/strict";
import test from "node:test";
import { GRADE_SYSTEM, gradeShortAnswerLocal, gradeUserPrompt, parseGradeModel } from "./grade-answer.ts";
import { handleGrade } from "./grade-request.ts";
import { gradeWithLearnModel } from "../server/learn/grade-short.ts";

const HESED_KEY = "faithful, covenant-based loyalty in action that often goes beyond strict obligation";
const HESED_PARAPHRASE = "covenant loyalty and steadfast kindness shown within a relationship";

test("a hesed paraphrase is substantively correct, not a wording miss", () => {
  const grade = gradeShortAnswerLocal(HESED_PARAPHRASE, HESED_KEY);
  assert.equal(grade.correct, true);
  assert.equal(grade.partial, false);
  assert.ok(grade.score >= 0.55);
});

test("the expected wording and an empty answer", () => {
  assert.equal(gradeShortAnswerLocal(HESED_KEY, HESED_KEY).correct, true);
  assert.equal(gradeShortAnswerLocal("   ", HESED_KEY).correct, false);
  assert.equal(gradeShortAnswerLocal("the sky is blue", HESED_KEY).correct, false);
  assert.equal(gradeShortAnswerLocal("the sky is blue", HESED_KEY).score, 0);
});

test("a paraphrase of the Gospel of John starter key is correct", () => {
  const expected = "The Word was God and became flesh.";
  const given = "the divine Word took on humanity";
  const grade = gradeShortAnswerLocal(given, expected);
  assert.equal(grade.correct, true);
  assert.equal(grade.partial, false);
  assert.ok(grade.score >= 0.55);
});

test("a paraphrase that hits both Lord's Prayer key points is correct", () => {
  const expected =
    "Both address God as Father and ask for daily bread; Matthew is longer, with extra petitions Luke omits.";
  const given =
    "both start by calling God Father and ask for daily food; Matthew's is longer, with extra lines Luke leaves out";
  const grade = gradeShortAnswerLocal(given, expected);
  assert.equal(grade.correct, true);
  assert.equal(grade.partial, false);
  assert.ok(grade.score >= 0.8);
  assert.match(GRADE_SYSTEM, /Do not require the lesson's terms/);
  assert.match(GRADE_SYSTEM, /contradicts the lesson/);
  const prompt = gradeUserPrompt({
    question: "Name one shared and one varying feature of Matthew's and Luke's Lord's Prayer.",
    expected,
    given,
    rationale: "Both open by calling God Father and ask for daily bread. Matthew keeps lines Luke leaves out.",
  });
  assert.match(prompt, /match their meaning, not these words/);
  assert.match(prompt, /do not require this wording/);
});

test("one shared concept is partial credit, not a full mark", () => {
  const grade = gradeShortAnswerLocal("it is about a covenant", HESED_KEY);
  assert.equal(grade.correct, false);
  assert.equal(grade.partial, true);
  assert.ok(grade.score > 0 && grade.score < 0.75);
});

test("a model grade trusts an explicit correct flag and fills partial from the score", () => {
  assert.deepEqual(parseGradeModel({ score: 0.82, correct: true, partial: false }), {
    correct: true,
    partial: false,
    score: 0.82,
  });
  const partial = parseGradeModel({ score: 0.5, correct: false, partial: true });
  assert.equal(partial.correct, false);
  assert.equal(partial.partial, true);
  assert.equal(partial.score, 0.5);
  assert.throws(() => parseGradeModel({ note: "no score" }));
});

test("the grade route returns the model result and does not call the model when signed out", async () => {
  const denied = await handleGrade({
    owned: Response.json({ error: "Sign in required." }, { status: 401 }),
    readBody: async () => ({ question: "Q", expected: "A", given: "A" }),
    grade: async () => {
      throw new Error("should not grade");
    },
  });
  assert.equal(denied.status, 401);
  const ok = await handleGrade({
    owned: { userId: "user_1" },
    readBody: async () => ({
      question: "What is hesed?",
      expected: "faithful, covenant-based loyalty in action that often goes beyond strict obligation",
      given: "covenant loyalty and steadfast kindness shown within a relationship",
    }),
    grade: async (input) => gradeShortAnswerLocal(input.given, input.expected),
  });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { correct: boolean };
  assert.equal(body.correct, true);
});

test("mock Learn grading uses the semantic grader on the worker role path", async () => {
  const grade = await gradeWithLearnModel({ MOCK_AI: "1" } as never, "user_1", "plan-1", {
    question: "What is hesed?",
    expected: "faithful, covenant-based loyalty in action that often goes beyond strict obligation",
    given: "covenant loyalty and steadfast kindness shown within a relationship",
  });
  assert.equal(grade.correct, true);
});

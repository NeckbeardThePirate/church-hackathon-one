import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildLearnChatContext } from "../../learn/agent-context.ts";
import type { LearnLesson, LearnPlan } from "../../learn/types.ts";
import { mockModelText } from "./mock-llm.ts";
import { SOURCE_TEXT_RULE } from "./source-policy.ts";

const VERSE = /For God so loved|For all have sinned|In the beginning God|the wages of sin|Those whom God effectually/i;

test("the shared rule forbids invented verse, confession, and father wording", () => {
  assert.match(SOURCE_TEXT_RULE, /Do not write Bible verse text/);
  assert.match(SOURCE_TEXT_RULE, /confession text/);
  assert.match(SOURCE_TEXT_RULE, /church father quotations/);
  assert.match(SOURCE_TEXT_RULE, /references only/);
  assert.doesNotMatch(SOURCE_TEXT_RULE, VERSE);
});

test("teach, gap, review, check, and tutor prompts use that one rule", () => {
  const stages = readFileSync(new URL("./stages.ts", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../learn-chat.ts", import.meta.url), "utf8");
  assert.match(chunk(stages, "runTeach"), /teachConceptRules\(lesson\.order\)/);
  for (const name of ["runGapTeach", "runReview", "runGapCheck", "runCheck", "runAssemble"]) {
    assert.match(chunk(stages, name), /SOURCE_TEXT_RULE/, name);
  }
  assert.match(chat, /SOURCE_TEXT_RULE/);
  assert.match(chat, /practice lesson/);
  assert.match(chat, /teach-time quiz bank/);
  assert.match(chat, /retrieved from the library/);
  assert.doesNotMatch(stages, VERSE);
  assert.doesNotMatch(chat, VERSE);
});

test("MOCK_AI fixtures name references and do not write source wording", () => {
  const teach = mockModelText("You write one lesson", "Topic: faith\nLesson 1", {
    planId: "p",
    stage: "teach",
    lessonId: "l1",
  });
  const gap = mockModelText("You write a short practice lesson", "conceptLabel: Faith", {
    planId: "p",
    stage: "teach",
    lessonId: "gap-1",
  });
  for (const text of [teach, gap]) {
    const body = JSON.parse(text) as { scriptureRefs: { reference: string }[]; libraryRefs: { reference: string }[] };
    assert.equal(body.scriptureRefs[0]?.reference, "Romans 3:21-26");
    assert.equal(body.libraryRefs[0]?.reference, "Westminster Confession of Faith 11.1");
    assert.doesNotMatch(text, VERSE);
  }
});

test("a gap lesson and a review item carry retrieved wording into the tutor context", () => {
  const retrieved = "Retrieved Romans wording from the library.";
  const confession = "Retrieved confession wording from the library.";
  const gap = lesson("gap-1", "gap");
  gap.scripture = [{ reference: "Romans 3:21-26", text: retrieved, note: "Why it connects." }];
  gap.library = [
    {
      id: "dev-wcf-11",
      source: "confession",
      label: "Westminster Confession of Faith 11.1",
      text: confession,
      note: "Why it connects.",
    },
  ];
  const plan = course([gap]);
  const focused = buildLearnChatContext(plan, { screen: "lesson", lessonId: "gap-1" });
  assert.equal(focused.lesson?.kind, "gap");
  assert.equal(focused.lesson?.scripture[0]?.text, retrieved);
  assert.equal(focused.lesson?.library?.[0]?.text, confession);

  const review = buildLearnChatContext(plan, { screen: "overview" }, {
    lessonId: "gap-1",
    conceptLabel: "Faith",
    question: "What receives the gift?",
  });
  assert.equal(review.review?.question, "What receives the gift?");
  assert.equal(review.review?.lesson?.scripture[0]?.text, retrieved);
  assert.equal(review.review?.lesson?.library?.[0]?.text, confession);
  assert.equal(review.review?.lesson?.quiz.some((item) => "answer" in item), false);
});

function chunk(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, name);
  const next = source.indexOf("\nasync function ", start + 1);
  const nextExport = source.indexOf("\nexport async function ", start + 1);
  const end = [next, nextExport].filter((index) => index > start).sort((a, b) => a - b)[0] ?? source.length;
  return source.slice(start, end);
}

function lesson(id: string, kind: "core" | "gap"): LearnLesson {
  return {
    id,
    order: 1,
    title: "The gift",
    objectives: ["Explain the main idea"],
    prerequisiteLessonIds: [],
    estimatedMinutes: 20,
    searchHints: [],
    status: "ok",
    teaching: [{ type: "paragraph", text: "Faith receives a gift." }],
    videos: [],
    articles: [],
    books: [],
    scripture: [],
    library: [],
    quiz: [
      {
        kind: "short",
        question: "What receives the gift?",
        answer: "Faith receives a gift.",
        rationale: "The lesson says so.",
        objectiveIndex: 0,
        conceptId: "l1-faith",
        conceptLabel: "Faith",
      },
    ],
    warnings: [],
    kind,
  };
}

function course(lessons: LearnLesson[]): LearnPlan {
  return {
    id: "plan-1",
    topic: "Faith",
    title: "Faith",
    complexity: "simple",
    perspective: "neutral",
    status: "complete",
    prerequisites: [],
    objectives: ["Explain the main idea"],
    lessons,
    courseBooks: [],
    finalAssessment: [],
    warnings: [],
    createdAt: 1,
  };
}

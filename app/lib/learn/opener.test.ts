import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENER_MAX_QUESTIONS,
  OPENER_MIN_QUESTIONS,
  beginOpenerTurn,
  diagnosticBrief,
  freshOpener,
  openerStep,
  openerSummary,
  openerUserPrompt,
  parseOpenerAction,
  parseOpenerQuestion,
  planAdaptation,
  planSteerLine,
  presentOpener,
  reduceOpener,
  scopeSteerLine,
  type AdaptableLesson,
  type OpenerQuestionDraft,
  type OpenerState,
} from "./opener.ts";

const BAND = { min: 3, max: 5, minutes: 25 };

function lesson(id: string, order: number, title: string, objective: string, extra: Partial<AdaptableLesson> = {}): AdaptableLesson {
  return {
    id,
    order,
    title,
    objectives: [objective],
    prerequisiteLessonIds: order === 1 ? [] : [`l${order - 1}`],
    estimatedMinutes: 30,
    searchHints: [title],
    pending: true,
    started: false,
    ...extra,
  };
}

const PATH = [
  lesson("l1", 1, "Justification by faith", "Explain justification by faith"),
  lesson("l2", 2, "Works of the law", "Explain works of the law"),
  lesson("l3", 3, "Union with Christ", "Describe union with Christ"),
  lesson("l4", 4, "Assurance", "Explain assurance"),
];

const DRAFT: OpenerQuestionDraft = {
  prompt: "How familiar is justification by faith?",
  probe: "justification by faith",
  stop: false,
  choices: [
    { id: "a", label: "I can explain it", reading: "strength", concept: "justification by faith" },
    { id: "b", label: "I mix it up with sanctification", reading: "gap", concept: "justification by faith" },
    { id: "c", label: "I know the phrase only", reading: "gap", concept: "sanctification" },
    { id: "d", label: "I'm not sure yet", reading: "unsure", concept: "justification by faith" },
  ],
};

function ask(state: OpenerState, draft: OpenerQuestionDraft = DRAFT): OpenerState {
  const started = reduceOpener(state, { type: "start" });
  assert.deepEqual(started.effects.map((effect) => effect.type), ["generate"]);
  const generated = reduceOpener(started.state, { type: "generated", question: draft });
  assert.equal(generated.effects[0]?.type, "show");
  return generated.state;
}

test("the opener asks the next question from earlier answers and stops between 3 and 4", () => {
  assert.equal(OPENER_MIN_QUESTIONS, 3);
  assert.equal(OPENER_MAX_QUESTIONS, 4);
  let state = freshOpener();
  state = ask(state, { ...DRAFT, stop: true });
  const first = reduceOpener(state, { type: "answer", questionId: "q1", choiceId: "d" });
  assert.deepEqual(first.state.diagnostic.gaps, ["justification by faith"]);
  assert.deepEqual(first.effects.map((effect) => effect.type), ["steer", "generate"]);

  state = reduceOpener(first.state, { type: "generated", question: { ...DRAFT, prompt: "Where is sanctification still fuzzy?", stop: true } }).state;
  const second = reduceOpener(state, { type: "answer", questionId: "q2", choiceId: "a" });
  assert.ok(second.effects.some((effect) => effect.type === "generate"));
  assert.equal(second.state.status, "open");

  state = reduceOpener(second.state, { type: "generated", question: { ...DRAFT, prompt: "What should the path emphasize?", stop: true } }).state;
  const third = reduceOpener(state, { type: "answer", questionId: "q3", choiceId: "b" });
  assert.equal(third.state.status, "closed");
  assert.equal(third.state.reason, "complete");
  assert.ok(third.effects.some((effect) => effect.type === "steer"));
  assert.equal(third.state.answers.length, 3);

  const shown = presentOpener(third.state);
  assert.equal(shown.status, "closed");
  assert.equal(shown.question, undefined);
  assert.match(shown.summary ?? "", /justification by faith/);
});

test("a stop flag is ignored before the minimum, and the fourth answer always closes", () => {
  let state = freshOpener();
  state = reduceOpener(state, { type: "generated", question: { ...DRAFT, stop: true } }).state;
  state = reduceOpener(state, { type: "answer", questionId: "q1", choiceId: "a" }).state;
  state = reduceOpener(state, { type: "generated", question: { ...DRAFT, stop: true } }).state;
  state = reduceOpener(state, { type: "answer", questionId: "q2", choiceId: "a" }).state;
  assert.equal(state.status, "open");

  for (let n = state.answers.length + 1; n <= 4; n += 1) {
    state = reduceOpener(state, { type: "generated", question: { ...DRAFT, stop: false } }).state;
    state = reduceOpener(state, { type: "answer", questionId: `q${n}`, choiceId: "a" }).state;
  }
  assert.equal(state.status, "closed");
  assert.equal(state.answers.length, 4);
  const again = reduceOpener(state, { type: "answer", questionId: "q4", choiceId: "a" });
  assert.equal(again.state.status, "closed");
  assert.deepEqual(again.effects, []);
});

test("strength replaces a gap on the same concept, and an unknown choice does not advance", () => {
  let state = ask(freshOpener());
  state = reduceOpener(state, { type: "answer", questionId: "q1", choiceId: "b" }).state;
  assert.deepEqual(state.diagnostic.gaps, ["justification by faith"]);
  const pending = ask(state, { ...DRAFT, prompt: "Can you trace justification by faith through the passage?" });
  const stuck = reduceOpener(pending, { type: "answer", questionId: "q2", choiceId: "missing" });
  assert.equal(stuck.state.answers.length, pending.answers.length);
  assert.equal(stuck.effects[0]?.type, "show");

  state = reduceOpener(pending, { type: "answer", questionId: "q2", choiceId: "a" }).state;
  assert.deepEqual(state.diagnostic.gaps, []);
  assert.deepEqual(state.diagnostic.strengths, ["justification by faith"]);
});

test("skip and model failure close the check without throwing away answers already given", () => {
  const open = ask(freshOpener());
  const skipped = reduceOpener(open, { type: "skip" });
  assert.equal(skipped.state.status, "closed");
  assert.equal(skipped.state.reason, "skipped");
  assert.ok(skipped.effects.some((effect) => effect.type === "steer"));

  const answered = reduceOpener(open, { type: "answer", questionId: "q1", choiceId: "c" }).state;
  const failed = reduceOpener(answered, { type: "fail" });
  assert.equal(failed.state.reason, "complete");
  assert.deepEqual(failed.state.diagnostic.gaps, ["sanctification"]);

  const empty = reduceOpener(freshOpener(), { type: "fail" });
  assert.equal(empty.state.reason, "unavailable");
  assert.deepEqual(empty.state.diagnostic, { strengths: [], gaps: [] });

  const again = beginOpenerTurn(empty.state, { type: "start" }, 1_000);
  assert.equal(again.state.status, "open");
  assert.equal(again.effects[0]?.type, "generate");

  const skippedCheck = reduceOpener(freshOpener(), { type: "skip" }).state;
  const stuck = beginOpenerTurn(skippedCheck, { type: "start" }, 1_000);
  assert.equal(stuck.state.status, "closed");
  assert.equal(stuck.state.reason, "skipped");
  assert.deepEqual(stuck.effects, []);
});

test("the check card stays up until a question, a skip, or a finished diagnostic", () => {
  assert.equal(openerStep(null), "wait");
  assert.equal(openerStep({ status: "ready", answered: 0 }), "wait");
  assert.equal(openerStep({ status: "closed", reason: "unavailable", answered: 0 }), "wait");
  assert.equal(
    openerStep({ status: "asking", answered: 0, question: { id: "q1", prompt: "How familiar is the prayer?", choices: [] } }),
    "show",
  );
  assert.equal(openerStep({ status: "closed", reason: "skipped", answered: 0 }), "done");
  assert.equal(openerStep({ status: "closed", reason: "complete", answered: 3 }), "done");
  assert.equal(openerStep({ status: "closed", reason: "unavailable", answered: 2 }), "done");
});

test("a fresh generation lock blocks a second question, and a stale lock does not stick", () => {
  const now = 10_000;
  const claimed = beginOpenerTurn(freshOpener(), { type: "start" }, now);
  assert.equal(claimed.state.generating, true);
  const busy = beginOpenerTurn(claimed.state, { type: "start" }, now + 500);
  assert.equal(busy.effects[0]?.type, "busy");
  assert.equal(busy.state.generating, true);

  const stale = beginOpenerTurn(claimed.state, { type: "start" }, now + 30_000);
  assert.equal(stale.effects[0]?.type, "generate");
  assert.equal(stale.state.generating, true);

  const skipped = beginOpenerTurn(claimed.state, { type: "skip" }, now + 500);
  assert.equal(skipped.state.status, "closed");
  assert.equal(skipped.state.generating, false);
});

test("question parsing keeps a quick unsure choice and rejects a short list", () => {
  const parsed = parseOpenerQuestion({
    prompt: "Where are you with adoption?",
    probe: "adoption",
    stop: false,
    choices: [
      { id: "a", label: "I can explain it", reading: "strength", concept: "adoption" },
      { id: "b", label: "I mix it up with justification", reading: "gap", concept: "adoption" },
    ],
  });
  assert.equal(parsed.choices.at(-1)?.reading, "unsure");
  assert.equal(parsed.choices.length, 3);
  assert.throws(() => parseOpenerQuestion({ prompt: "Hi", probe: "adoption", choices: [{ id: "a", label: "Only one", reading: "gap", concept: "adoption" }] }));
  const bornAgain = parseOpenerQuestion({
    prompt: "How familiar is being born again?",
    probe: "being born again",
    choices: [
      { id: "a", label: "I can explain it", reading: "strong", concept: "being born again" },
      { id: "b", label: "I mix it up with baptism", reading: "gap", concept: "being born again" },
      { id: "c", label: "I don't know", reading: "strength|gap|unsure", concept: "being born again" },
    ],
  });
  assert.equal(bornAgain.choices[0]?.reading, "strength");
  assert.equal(bornAgain.choices.find((choice) => choice.label === "I don't know")?.reading, "unsure");
  assert.deepEqual(parseOpenerAction({ action: "skip" }), { ok: true, action: { type: "skip" } });
  assert.equal(parseOpenerAction({ action: "answer", choiceId: "a" }).ok, false);
});

test("the prompt for the next question includes the topic and every earlier answer", () => {
  const state = ask(freshOpener());
  const prompt = openerUserPrompt({
    topic: "Romans 3",
    notes: "I keep mixing justification and sanctification.",
    passages: [{ reference: "Romans 3:21-26", text: "Library wording stays on the server." }],
    questions: state.questions,
    answers: [{ questionId: "q1", choiceId: "b" }],
  });
  assert.match(prompt, /Romans 3/);
  assert.match(prompt, /Earlier answers:/);
  assert.match(prompt, /Chose: I mix it up with sanctification/);
  assert.match(prompt, /question 2 of at most 4/);
  const shown = presentOpener(state);
  assert.equal(shown.status, "asking");
  assert.equal(JSON.stringify(shown).includes("reading"), false);
});

test("an outline drops a known lesson, adds a gap, and a second pass holds still", () => {
  const first = planAdaptation(PATH, { strengths: ["justification by faith"], gaps: ["adoption"] }, BAND);
  assert.equal(first.dropIds.includes("l1"), true);
  assert.equal(first.lessons.some((item) => item.id === "l1"), false);
  assert.equal(first.addIds.length, 1);
  assert.equal(first.lessons.at(-1)?.title, "Adoption");
  assert.ok(first.lessons.at(-1)?.prerequisiteLessonIds.includes("l4"));
  assert.match(first.note, /Justification by faith/);
  assert.match(first.note, /Adoption/);

  const second = planAdaptation(first.lessons, { strengths: ["justification by faith"], gaps: ["adoption"] }, BAND);
  assert.deepEqual(second.dropIds, []);
  assert.deepEqual(second.addIds, []);
  assert.deepEqual(second.focusIds, []);
  assert.equal(second.note, "");
  assert.deepEqual(
    second.lessons.map((item) => item.id),
    first.lessons.map((item) => item.id),
  );
});

test("a started lesson stays, a full band focuses the gap, and the floor retargets instead of deleting", () => {
  const started = planAdaptation(
    PATH.map((item) => (item.id === "l1" ? { ...item, started: true, pending: false } : item)),
    { strengths: ["justification by faith"], gaps: ["adoption"] },
    BAND,
  );
  assert.equal(started.dropIds.includes("l1"), false);
  assert.equal(started.lessons[0]?.id, "l1");
  assert.equal(started.lessons.at(-1)?.title, "Adoption");

  const crowded = planAdaptation(
    [...PATH, lesson("l5", 5, "Peace with God", "Explain peace with God")],
    { strengths: [], gaps: ["adoption"] },
    BAND,
  );
  assert.deepEqual(crowded.addIds, []);
  assert.deepEqual(crowded.dropIds, []);
  assert.deepEqual(crowded.focusIds, ["l5"]);
  assert.ok(crowded.lessons.find((item) => item.id === "l5")?.objectives.some((objective) => /adoption/i.test(objective)));

  const floor = planAdaptation(PATH.slice(0, 3), { strengths: ["justification by faith"], gaps: ["adoption"] }, BAND);
  assert.deepEqual(floor.dropIds, []);
  assert.equal(floor.lessons[0]?.title, "Adoption");
  assert.equal(floor.lessons[0]?.id, "l1");
  const again = planAdaptation(floor.lessons, { strengths: ["justification by faith"], gaps: ["adoption"] }, BAND);
  assert.equal(again.note, "");
});

test("an empty check leaves the outline alone, and the planner lines name the gaps", () => {
  const same = planAdaptation(PATH, { strengths: [], gaps: [] }, BAND);
  assert.equal(same.note, "");
  assert.equal(same.lessons.length, PATH.length);
  assert.equal(diagnosticBrief({ strengths: [], gaps: [] }), "");
  assert.match(scopeSteerLine({ strengths: ["assurance"], gaps: ["adoption"] }), /adoption/);
  assert.match(planSteerLine({ strengths: ["assurance"], gaps: ["adoption"] }, 4), /exactly 4 lessons/);
  assert.equal(openerSummary({ strengths: ["assurance"], gaps: [] }), "Your path will move ahead where assurance is already familiar.");
});

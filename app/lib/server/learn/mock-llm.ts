import type { LlmMeta } from "./llm";

const FAITH = /bible|jesus|christ|god|church|faith|prayer|psalm|baptism|scripture|reformed|gospel|sin|grace|confession/i;

/**
 * Deterministic JSON for local runs when Workers AI is not reachable.
 * Enabled only by MOCK_AI=1. Production leaves that var unset.
 */
export function mockModelText(system: string, user: string, meta: LlmMeta): string {
  if (meta.stage === "check" && /Grade short answers/i.test(system)) {
    return JSON.stringify({ verdicts: [{ index: 2, correct: true }] });
  }
  if (meta.stage === "check") {
    return JSON.stringify({
      answers: [
        { index: 0, answer: "Faith" },
        { index: 1, answer: "Romans" },
        { index: 2, answer: "Faith receives a gift." },
      ],
    });
  }
  if (meta.stage === "review") {
    const articles = /A1\./.test(user)
      ? [{ id: "A1", review: "An open reference article that introduces the topic in plain language.", perspective: "Academic" }]
      : [];
    return JSON.stringify({ articles, videos: [] });
  }
  if (meta.stage === "critic") return JSON.stringify({ issues: [] });
  if (/short practice lesson/i.test(system)) return mockGapTeach(user);
  if (meta.stage === "plan") {
    return JSON.stringify({
      lessons: [
        {
          title: "The heart of the topic",
          objectives: ["Explain the main idea in your own words", "Connect it to a primary text"],
          prerequisiteLessons: [],
          estimatedMinutes: 20,
          searchHints: ["introduction", "primary text"],
        },
      ],
    });
  }
  if (meta.stage === "scope") {
    const topic = /Topic:\s*(.+)/.exec(user)?.[1]?.split("\n")[0]?.trim() || "Study";
    const faith = FAITH.test(user);
    return JSON.stringify({
      title: topic.slice(0, 80),
      complexity: "simple",
      lessonCount: 1,
      prerequisites: [],
      coreConcepts: [topic.slice(0, 48)],
      objectives: ["Explain the main idea"],
      isFaithRelevant: faith,
    });
  }
  return JSON.stringify({
    teaching: [
      { type: "paragraph", text: "This lesson stays with one idea and the texts that support it." },
      { type: "heading2", text: "Key idea" },
      { type: "bullet", text: "Faith receives a gift." },
      { type: "paragraph", text: "Read the cited passage slowly. The wording below comes from the Bible text, not from this summary." },
      { type: "heading2", text: "Discuss" },
      { type: "bullet", text: "Where do you see this in Romans 3?" },
    ],
    quiz: [
      {
        kind: "mc",
        question: "What receives the gift?",
        choices: ["Faith", "Works", "Law", "Pride"],
        answer: "Faith",
        rationale: "The lesson says faith receives a gift.",
        objectiveIndex: 0,
        conceptId: "l1-gift",
        conceptLabel: "The gift",
        alternate: {
          kind: "mc",
          question: "Which of these receives the gift in the lesson?",
          choices: ["Faith", "Works", "Law", "Pride"],
          answer: "Faith",
          rationale: "The lesson says faith receives a gift.",
          objectiveIndex: 0,
          conceptId: "l1-gift",
          conceptLabel: "The gift",
        },
      },
      {
        kind: "mc",
        question: "Which book is cited?",
        choices: ["Romans", "Acts", "Ruth", "Jonah"],
        answer: "Romans",
        rationale: "The discussion names Romans 3.",
        objectiveIndex: 1,
        conceptId: "l1-romans",
        conceptLabel: "The cited book",
        alternate: {
          kind: "mc",
          question: "The discussion points to which letter?",
          choices: ["Romans", "Acts", "Ruth", "Jonah"],
          answer: "Romans",
          rationale: "The discussion names Romans 3.",
          objectiveIndex: 1,
          conceptId: "l1-romans",
          conceptLabel: "The cited book",
        },
      },
      {
        kind: "short",
        question: "In one sentence, what is the main idea?",
        answer: "Faith receives a gift.",
        rationale: "Matches the key idea.",
        objectiveIndex: 0,
        conceptId: "l1-main-idea",
        conceptLabel: "The main idea",
        alternate: {
          kind: "short",
          question: "What does the lesson say faith receives?",
          answer: "A gift.",
          rationale: "Matches the key idea.",
          objectiveIndex: 0,
          conceptId: "l1-main-idea",
          conceptLabel: "The main idea",
        },
      },
    ],
    scriptureRefs: FAITH.test(`${system}\n${user}`)
      ? [{ reference: "Romans 3:21-26", note: "Paul says righteousness is given through faith in Christ." }]
      : [],
    libraryRefs: FAITH.test(`${system}\n${user}`)
      ? [{ reference: "Westminster Confession of Faith 11.1", note: "The confession's chapter on this idea." }]
      : [],
  });
}

/** Tagged practice quiz. Answers match the check mock so MOCK_AI can finish a gap lesson. */
function mockGapTeach(user: string): string {
  const found = [...user.matchAll(/conceptId: ([A-Za-z0-9._:-]+) \| conceptLabel: ([^\n]+)/g)].map((match) => ({
    id: match[1] ?? "l1-gap",
    label: (match[2] ?? "The missed idea").trim(),
  }));
  const concepts = found.length ? found : [{ id: "l1-gap", label: "The missed idea" }];
  const stems = [
    {
      kind: "mc" as const,
      question: "What receives the gift?",
      choices: ["Faith", "Works", "Law", "Pride"],
      answer: "Faith",
    },
    {
      kind: "mc" as const,
      question: "Which book is cited?",
      choices: ["Romans", "Acts", "Ruth", "Jonah"],
      answer: "Romans",
    },
    {
      kind: "short" as const,
      question: "In one sentence, what is the main idea?",
      answer: "Faith receives a gift.",
    },
  ];
  const quiz = stems.map((stem, index) => {
    const concept = concepts[index] ?? concepts[index % concepts.length]!;
    const objectiveIndex = Math.max(0, concepts.findIndex((item) => item.id === concept.id));
    const item: Record<string, unknown> = {
      ...stem,
      rationale: "The practice lesson states this.",
      objectiveIndex,
      conceptId: concept.id,
      conceptLabel: concept.label,
    };
    if (index < concepts.length) {
      item.alternate = {
        kind: "short",
        question: "Restate the idea in a few words.",
        answer: "Faith receives a gift.",
        rationale: "The practice lesson states this.",
        objectiveIndex,
        conceptId: concept.id,
        conceptLabel: concept.label,
      };
    }
    return item;
  });
  return JSON.stringify({
    teaching: [
      { type: "paragraph", text: "This practice stays with the ideas that were missed." },
      { type: "heading2", text: "Key idea" },
      { type: "bullet", text: "Faith receives a gift." },
      { type: "heading2", text: "Discuss" },
      { type: "bullet", text: "Which idea was hardest?" },
    ],
    quiz,
    scriptureRefs: FAITH.test(user)
      ? [{ reference: "Romans 3:21-26", note: "Cited for this practice lesson." }]
      : [],
    libraryRefs: FAITH.test(user)
      ? [{ reference: "Westminster Confession of Faith 11.1", note: "Cited for this practice lesson." }]
      : [],
  });
}

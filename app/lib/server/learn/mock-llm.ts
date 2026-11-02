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
      },
      {
        kind: "mc",
        question: "Which book is cited?",
        choices: ["Romans", "Acts", "Ruth", "Jonah"],
        answer: "Romans",
        rationale: "The discussion names Romans 3.",
        objectiveIndex: 1,
      },
      {
        kind: "short",
        question: "In one sentence, what is the main idea?",
        answer: "Faith receives a gift.",
        rationale: "Matches the key idea.",
        objectiveIndex: 0,
      },
    ],
    scriptureRefs: FAITH.test(`${system}\n${user}`)
      ? [{ reference: "Romans 3:21-26", note: "Paul says righteousness is given through faith in Christ." }]
      : [],
  });
}

/**
 * Bundled sample path for the signed-out landing.
 * Static on purpose: no D1 read, no session, and nothing to write.
 * The quick check is client state on top of that bundle. A miss only
 * adds a sample gap to the map in memory.
 * Scripture is the Berean Study Bible. Library lines are Matthew Henry,
 * the Westminster Confession, and Augustine on this Gospel.
 */

import type { PathMapNode } from "./path-map.ts";

export const GUEST_HONESTY_COPY = "This lesson is partially AI generated.";

export const GUEST_PATH_TITLE = "The Gospel of John";

/** The step a judge sees open when the landing first paints. */
export const GUEST_OPEN_LESSON_ID = "john-written";

/** Header XP before the sample check awards anything. */
export const GUEST_SAMPLE_BASE_XP = 60;

/** Same amount as a first-try quiz answer. Sample only: nothing is saved. */
export const GUEST_SAMPLE_CHECK_XP = 5;

/** Practice gap that exists only after a miss. Not part of the bundled path. */
export const GUEST_SAMPLE_GAP_ID = "gap-john-believe";

export type GuestCheckChoice = {
  id: string;
  label: string;
};

export type GuestSampleQuestion = {
  lessonId: string;
  prompt: string;
  choices: readonly GuestCheckChoice[];
  correctId: string;
  encourage: string;
  miss: string;
  opened: string;
};

/** One bundled question from Written that you may believe. Graded in the browser. */
export const GUEST_SAMPLE_QUESTION: GuestSampleQuestion = {
  lessonId: GUEST_OPEN_LESSON_ID,
  prompt: "John says these signs were written so that you may believe Jesus is what?",
  choices: [
    { id: "christ", label: "The Christ, the Son of God" },
    { id: "prophet", label: "A prophet only, until the temple is rebuilt" },
    { id: "priest", label: "The high priest of Aaron’s line" },
  ],
  correctId: "christ",
  encourage:
    "Yes. The signs are written so that you may believe that Jesus is the Christ, the Son of God, and that by believing you may have life in His name.",
  miss: "Not that one. John names the Christ, the Son of God. A practice step is now on the path for that line.",
  opened: "This is what a miss does. A practice step is now on the path for the Christ, the Son of God.",
};

export type GuestSamplePhase = "idle" | "correct" | "missed" | "opened";

export type GuestSampleState = {
  pickedId: string | null;
  /** Null until a choice is picked. */
  correct: boolean | null;
  /** True once the sample practice gap is on the map. */
  gapSpawned: boolean;
  /** Sample total shown beside the streak. */
  xp: number;
  /** How many times this sample has awarded XP. Stays 0 or 1. */
  awardTick: number;
};

export const GUEST_SAMPLE_GAP_NODE: PathMapNode = {
  id: GUEST_SAMPLE_GAP_ID,
  kind: "gap",
  title: "Practice: that you may believe",
  order: 3,
  state: "available",
  unmet: [],
  parentId: GUEST_OPEN_LESSON_ID,
  current: false,
  estimatedMinutes: 20,
  building: false,
};

const CONFESSION = "Westminster Confession of Faith";

export type GuestScriptureCitation = {
  kind: "scripture";
  reference: string;
  text: string;
  note: string;
};

export type GuestLibraryCitation = {
  kind: "library";
  source: "confession" | "father" | "commentary";
  label: string;
  detail: string;
  text: string;
  note: string;
};

export type GuestCitation = GuestScriptureCitation | GuestLibraryCitation;

export type GuestLessonPreview = {
  id: string;
  kicker: string;
  title: string;
  excerpt: readonly string[];
  citations: readonly GuestCitation[];
  /** Spaced-review half of the sample chip. */
  review: string;
  /** XP half of the sample chip. */
  xp: string;
};

export const GUEST_PATH_NODES: readonly PathMapNode[] = [
  {
    id: "john-word",
    kind: "core",
    title: "The Word with God",
    order: 1,
    state: "mastered",
    unmet: [],
    parentId: null,
    current: false,
    estimatedMinutes: 25,
    building: false,
  },
  {
    id: "john-flesh",
    kind: "core",
    title: "The Word made flesh",
    order: 2,
    state: "mastered",
    unmet: [],
    parentId: null,
    current: false,
    estimatedMinutes: 25,
    building: false,
  },
  {
    id: "gap-john-flesh",
    kind: "gap",
    title: "Practice lesson ready",
    order: 2,
    state: "available",
    unmet: [],
    parentId: "john-flesh",
    current: false,
    estimatedMinutes: 20,
    building: false,
  },
  {
    id: "john-written",
    kind: "core",
    title: "Written that you may believe",
    order: 3,
    state: "in-progress",
    unmet: [],
    parentId: null,
    current: true,
    estimatedMinutes: 30,
    building: false,
  },
  {
    id: "john-sea",
    kind: "core",
    title: "Breakfast by the sea",
    order: 4,
    state: "locked",
    unmet: [{ id: "john-written", title: "Written that you may believe" }],
    parentId: null,
    current: false,
    estimatedMinutes: 30,
    building: false,
  },
  {
    id: "john-sheep",
    kind: "core",
    title: "Feed my sheep",
    order: 5,
    state: "locked",
    unmet: [{ id: "john-sea", title: "Breakfast by the sea" }],
    parentId: null,
    current: false,
    estimatedMinutes: 25,
    building: false,
  },
  {
    id: "final",
    kind: "final",
    title: "Final assessment",
    order: 6,
    state: "locked",
    unmet: [
      { id: "john-written", title: "Written that you may believe" },
      { id: "john-sea", title: "Breakfast by the sea" },
      { id: "john-sheep", title: "Feed my sheep" },
    ],
    parentId: null,
    current: false,
    building: false,
  },
];

const LESSONS: Record<string, GuestLessonPreview> = {
  "john-word": {
    id: "john-word",
    kicker: "Lesson 1 · mastered",
    title: "The Word with God",
    excerpt: [
      "John opens before Bethlehem. The first sentence does not start with a birth. It starts with the Word, who already was. The reading says the Word was with God, and the Word was God, and that all things were made through Him.",
      "Those are two claims, not one. “With God” keeps a distinction. “Was God” refuses to make the Word a lesser being. Matthew Henry, on this opening, keeps both. He says a turn to Christ is not a turn away from God, because Christ is with God and is God. The lesson sets that sentence beside the verse and does not let the commentary replace it.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "John 1:1-3",
        text: "In the beginning was the Word, and the Word was with God, and the Word was God. He was with God in the beginning. Through Him all things were made, and without Him nothing was made that has been made.",
        note: "The opening claims: the Word was with God, and the Word was God, and all things were made through Him. Berean Study Bible.",
      },
      {
        kind: "library",
        source: "commentary",
        label: "Matthew Henry",
        detail: "John 1:1–4",
        text: "The Word was with God, and the Word was God. Let none say that when we invite them to Christ we would draw them from God, for Christ is with God and is God; it is repeated in v. 2: the same, the very same that we believe in and preach, was in the beginning with God, that is, he was so from eternity. In the beginning the world was from God, as it was created by him; but the Word was with God, as ever with him.",
        note: "Commentary on the Whole Bible, on this prologue. Henry is not a second author of the verse. The lesson places his sentence beside it.",
      },
    ],
    review: "Spaced review · due in 6 days",
    xp: "30 XP",
  },
  "john-flesh": {
    id: "john-flesh",
    kicker: "Lesson 2 · mastered",
    title: "The Word made flesh",
    excerpt: [
      "Later in the same chapter the Word became flesh and made His dwelling among us. Became, here, is a real human life, not a costume. Hold the two claims together. The Word was God, and the Word became flesh.",
      "One check on this lesson did not stay put: whether “became flesh” withdraws “was God.” It does not. The practice step under this lesson is ready for that claim. The confession beside the verse is about Christ the Mediator, not a commentary written on John.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "John 1:14",
        text: "The Word became flesh and made His dwelling among us. We have seen His glory, the glory of the one and only Son from the Father, full of grace and truth.",
        note: "The Word became flesh and dwelt among us. Berean Study Bible.",
      },
      {
        kind: "library",
        source: "confession",
        label: CONFESSION,
        detail: "8.2",
        text: "The Son of God, the second person in the Trinity, being very and eternal God, of one substance and equal with the Father, did, when the fullness of time was come, take upon him man's nature, with all the essential properties, and common infirmities thereof, yet without sin; being conceived by the power of the Holy Ghost, in the womb of the virgin Mary, of her substance. So that two whole, perfect, and distinct natures, the Godhead and the manhood, were inseparably joined together in one person, without conversion, composition, or confusion. Which person is very God, and very man, yet one Christ, the only Mediator between God and man.",
        note: "Of Christ the Mediator. Two natures in one person. It is not a commentary on John 1. The lesson sets the claim next to “was God” and “became flesh.”",
      },
    ],
    review: "Spaced review · due tomorrow",
    xp: "20 XP",
  },
  "gap-john-flesh": {
    id: "gap-john-flesh",
    kicker: "Gap lesson · made flesh",
    title: "Practice lesson ready",
    excerpt: [
      "This short practice stays on the claim the earlier check missed. The Word was God and became flesh. “Was God” is not withdrawn when “became flesh” is added. Nothing in the verse says he stopped being God.",
      "Augustine, preaching this Gospel, says the Word was not ashamed to be born of man, and that the Word made flesh became a medicine, so that as by earth we were made blind, by earth we might be healed. He is preaching the incarnation. He does not replace the verse. On a signed-in path the practice would end in a few questions drawn from this lesson. Here you can read the excerpt and the sources. Nothing is graded, and nothing is stored.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "John 1:14",
        text: "The Word became flesh and made His dwelling among us. We have seen His glory, the glory of the one and only Son from the Father, full of grace and truth.",
        note: "The same flesh verse, retrieved again for the practice. Berean Study Bible.",
      },
      {
        kind: "library",
        source: "father",
        label: "Augustine",
        detail: "Tractates on the Gospel of John",
        text: "If the Word was not ashamed to be born of man, are men ashamed to be born of God? And because He did this, He cured us; and because He cured us, we see. For this, “that the Word was made flesh, and dwelt among us,” became a medicine unto us, so that as by earth we were made blind, by earth we might be healed; and having been healed, might behold what? “And we beheld,” he says, “His glory, the glory as of the Only-begotten of the Father, full of grace and truth.”",
        note: "Augustine on this Gospel: the Word made flesh became a medicine. He is preaching John, not replacing the verse.",
      },
    ],
    review: "Spaced review · ready when you are",
    xp: "40 XP",
  },
  "john-written": {
    id: "john-written",
    kicker: "Lesson 3 · in progress",
    title: "Written that you may believe",
    excerpt: [
      "John does not say he wrote down every work of Jesus. He says Jesus performed many other signs in the presence of His disciples, which are not written in this book. The ones that are written have a purpose.",
      "The purpose is the next verse. These are written so that you may believe that Jesus is the Christ, the Son of God, and that by believing you may have life in His name. The lesson keeps both halves: who Jesus is, and the life that believing brings. This step is the one in progress.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "John 20:30-31",
        text: "Jesus performed many other signs in the presence of His disciples, which are not written in this book. But these are written so that you may believe that Jesus is the Christ, the Son of God, and that by believing you may have life in His name.",
        note: "Why the signs were written: that you may believe, and that by believing you may have life. Berean Study Bible.",
      },
      {
        kind: "library",
        source: "confession",
        label: CONFESSION,
        detail: "14.2",
        text: "By this faith, a Christian believeth to be true whatsoever is revealed in the Word, for the authority of God himself speaking therein; and acteth differently upon that which each particular passage thereof containeth; yielding obedience to the commands, trembling at the threatenings, and embracing the promises of God for this life, and that which is to come. But the principal acts of saving faith are accepting, receiving, and resting upon Christ alone for justification, sanctification, and eternal life, by virtue of the covenant of grace.",
        note: "Of Saving Faith. The principal acts rest on Christ for eternal life. Not a commentary on John 20. The lesson sets that line beside the book’s purpose and does not swap one for the other.",
      },
    ],
    review: "Spaced review · after the quiz",
    xp: "10 XP",
  },
  [GUEST_SAMPLE_GAP_ID]: {
    id: GUEST_SAMPLE_GAP_ID,
    kicker: "Gap lesson · just opened",
    title: GUEST_SAMPLE_GAP_NODE.title,
    excerpt: [
      "This practice stays on the line the check missed. John does not say the signs were written to name a prophet only, or a priest of Aaron’s line. He says they were written so that you may believe that Jesus is the Christ, the Son of God, and that by believing you may have life in His name.",
      "On a signed-in path, a miss queues a short lesson like this and cites the library. Here the step is a sample. Nothing is graded, and nothing is stored.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "John 20:31",
        text: "But these are written so that you may believe that Jesus is the Christ, the Son of God, and that by believing you may have life in His name.",
        note: "The purpose verse, retrieved again for the line this check is about. Berean Study Bible.",
      },
      {
        kind: "library",
        source: "commentary",
        label: "Matthew Henry",
        detail: "John 20:26–31",
        text: "Here is the design of those that wrote the gospel. Some write books for their diversion, and publish them for their profit or applause, others to oblige the Athenian humour, others to instruct the world in arts and sciences for their secular advantage; but the evangelists wrote without any view of temporal benefit to themselves or others, but to bring men to Christ and heaven, and, in order to this, to persuade men to believe; and for this they took the most fitting methods, they brought to the world a divine revelation, supported with its due evidences.",
        note: "Commentary on the Whole Bible, on John 20:31. Henry says the evangelists wrote to persuade men to believe. The practice sets that sentence beside the verse. It does not swap John’s line for the commentary.",
      },
    ],
    review: "Spaced review · after this practice",
    xp: "40 XP",
  },
};

export function guestLesson(id: string): GuestLessonPreview | null {
  return LESSONS[id] ?? null;
}

export function initialGuestSample(): GuestSampleState {
  return {
    pickedId: null,
    correct: null,
    gapSpawned: false,
    xp: GUEST_SAMPLE_BASE_XP,
    awardTick: 0,
  };
}

export function resetGuestSample(): GuestSampleState {
  return initialGuestSample();
}

/** Where the sample check is in its script: unanswered, credited, missed, or opened without a pick. */
export function guestSamplePhase(state: GuestSampleState): GuestSamplePhase {
  if (state.correct === true) return "correct";
  if (state.correct === false) return "missed";
  if (state.gapSpawned) return "opened";
  return "idle";
}

export function guestSampleHeading(state: GuestSampleState): string | null {
  if (state.correct === true) return "That’s right";
  if (state.correct === false || state.gapSpawned) return "A practice step opened";
  return null;
}

export function guestSampleFeedback(state: GuestSampleState): string | null {
  if (state.correct === true) return GUEST_SAMPLE_QUESTION.encourage;
  if (state.correct === false) return GUEST_SAMPLE_QUESTION.miss;
  if (state.gapSpawned) return GUEST_SAMPLE_QUESTION.opened;
  return null;
}

export function guestChoiceVisual(state: GuestSampleState, choiceId: string): "idle" | "correct" | "wrong" {
  if (state.pickedId === null) return "idle";
  if (choiceId === GUEST_SAMPLE_QUESTION.correctId) return "correct";
  if (choiceId === state.pickedId) return "wrong";
  return "idle";
}

/**
 * Record one pick. A later pick is ignored.
 * The right answer awards sample XP and leaves the map alone.
 * A wrong answer puts the practice gap on the map.
 */
export function pickGuestSample(state: GuestSampleState, choiceId: string): GuestSampleState {
  if (state.pickedId !== null) return state;
  const known = GUEST_SAMPLE_QUESTION.choices.some((choice) => choice.id === choiceId);
  if (!known) return state;
  const correct = choiceId === GUEST_SAMPLE_QUESTION.correctId;
  if (correct) {
    return {
      pickedId: choiceId,
      correct: true,
      gapSpawned: state.gapSpawned,
      xp: state.xp + GUEST_SAMPLE_CHECK_XP,
      awardTick: state.awardTick + 1,
    };
  }
  return {
    pickedId: choiceId,
    correct: false,
    gapSpawned: true,
    xp: state.xp,
    awardTick: state.awardTick,
  };
}

/** The “See what happens when you miss” control. Does not award XP and does not change a pick. */
export function revealGuestMiss(state: GuestSampleState): GuestSampleState {
  if (state.gapSpawned) return state;
  return { ...state, gapSpawned: true };
}

/** Path nodes for this sample, with the practice gap inserted under its lesson once spawned. */
export function guestPathNodes(state: GuestSampleState): PathMapNode[] {
  if (!state.gapSpawned) return GUEST_PATH_NODES.slice();
  const nodes = GUEST_PATH_NODES.slice();
  const parentAt = nodes.findIndex((node) => node.id === GUEST_SAMPLE_GAP_NODE.parentId);
  const insertAt = parentAt >= 0 ? parentAt + 1 : nodes.length;
  nodes.splice(insertAt, 0, GUEST_SAMPLE_GAP_NODE);
  return nodes;
}

export function guestHighlightId(state: GuestSampleState): string | null {
  return state.gapSpawned ? GUEST_SAMPLE_GAP_ID : null;
}

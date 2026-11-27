/**
 * Bundled sample path for the signed-out landing.
 * Static on purpose: no D1 read, no session, and nothing to write.
 * The quick check is client state on top of that bundle. A miss only
 * adds a sample gap to the map in memory.
 * Scripture is the King James Version. Confession lines are the Westminster Confession.
 */

import type { PathMapNode } from "./path-map.ts";

export const GUEST_HONESTY_COPY =
  "Lessons and quizzes are AI-generated; Scripture and historical sources are retrieved from the library.";

export const GUEST_PATH_TITLE = "The Book of Ruth";

/** The step a judge sees open when the landing first paints. */
export const GUEST_OPEN_LESSON_ID = "ruth-field";

/** Header XP before the sample check awards anything. */
export const GUEST_SAMPLE_BASE_XP = 60;

/** Same amount as a first-try quiz answer. Sample only: nothing is saved. */
export const GUEST_SAMPLE_CHECK_XP = 5;

/** Practice gap that exists only after a miss. Not part of the bundled path. */
export const GUEST_SAMPLE_GAP_ID = "gap-ruth-wings";

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

/** One bundled question from The field of Boaz. Graded in the browser. */
export const GUEST_SAMPLE_QUESTION: GuestSampleQuestion = {
  lessonId: GUEST_OPEN_LESSON_ID,
  prompt: "Boaz says Ruth has come to trust under what?",
  choices: [
    { id: "wings", label: "The wings of the God of Israel" },
    { id: "gate", label: "The gate of the nearer kinsman" },
    { id: "roof", label: "The roof of her mother’s house" },
  ],
  correctId: "wings",
  encourage:
    "Yes. Boaz is naming the God she has come to trust. She is under the wings of the God of Israel.",
  miss: "Not that one. The blessing in the field is the wings of the God of Israel. A practice step is now on the path for that line.",
  opened: "This is what a miss does. A practice step is now on the path for the wings of the God of Israel.",
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
  title: "Practice: under his wings",
  order: 3,
  state: "available",
  unmet: [],
  parentId: GUEST_OPEN_LESSON_ID,
  current: false,
  estimatedMinutes: 20,
};

const CONFESSION = "Westminster Confession of Faith";

export type GuestScriptureCitation = {
  kind: "scripture";
  reference: string;
  text: string;
  note: string;
};

export type GuestConfessionCitation = {
  kind: "confession";
  label: string;
  detail: string;
  text: string;
  note: string;
};

export type GuestCitation = GuestScriptureCitation | GuestConfessionCitation;

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
    id: "ruth-bethlehem",
    kind: "core",
    title: "Out of Bethlehem",
    order: 1,
    state: "mastered",
    unmet: [],
    parentId: null,
    current: false,
    estimatedMinutes: 25,
  },
  {
    id: "ruth-vow",
    kind: "core",
    title: "Ruth's vow",
    order: 2,
    state: "mastered",
    unmet: [],
    parentId: null,
    current: false,
    estimatedMinutes: 25,
  },
  {
    id: "gap-ruth-hesed",
    kind: "gap",
    title: "Practice lesson ready",
    order: 2,
    state: "available",
    unmet: [],
    parentId: "ruth-vow",
    current: false,
    estimatedMinutes: 20,
  },
  {
    id: "ruth-field",
    kind: "core",
    title: "The field of Boaz",
    order: 3,
    state: "in-progress",
    unmet: [],
    parentId: null,
    current: true,
    estimatedMinutes: 30,
  },
  {
    id: "ruth-gate",
    kind: "core",
    title: "The nearer kinsman",
    order: 4,
    state: "locked",
    unmet: [{ id: "ruth-field", title: "The field of Boaz" }],
    parentId: null,
    current: false,
    estimatedMinutes: 30,
  },
  {
    id: "ruth-line",
    kind: "core",
    title: "The line of David",
    order: 5,
    state: "locked",
    unmet: [{ id: "ruth-gate", title: "The nearer kinsman" }],
    parentId: null,
    current: false,
    estimatedMinutes: 25,
  },
  {
    id: "final",
    kind: "final",
    title: "Final assessment",
    order: 6,
    state: "locked",
    unmet: [
      { id: "ruth-field", title: "The field of Boaz" },
      { id: "ruth-gate", title: "The nearer kinsman" },
      { id: "ruth-line", title: "The line of David" },
    ],
    parentId: null,
    current: false,
  },
];

const LESSONS: Record<string, GuestLessonPreview> = {
  "ruth-bethlehem": {
    id: "ruth-bethlehem",
    kicker: "Lesson 1 · mastered",
    title: "Out of Bethlehem",
    excerpt: [
      "A famine sends Elimelech’s family from Bethlehem into Moab. The story does not hurry past the cost. Elimelech dies, then both sons, and Naomi is left with two Moabite daughters-in-law and no heir to carry the name home.",
      "When she walks back into town she asks to be called Mara, bitter. This lesson stays with that sentence. It does not tidy her grief. The verse underneath is the text she speaks, retrieved for the lesson rather than written over it.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "Ruth 1:20-21",
        text: "And she said unto them, Call me not Naomi, call me Mara: for the Almighty hath dealt very bitterly with me. I went out full, and the LORD hath brought me home again empty: why then call ye me Naomi, seeing the LORD hath testified against me, and the Almighty hath afflicted me?",
        note: "Naomi’s own words at the gate of Bethlehem. King James Version.",
      },
      {
        kind: "confession",
        label: CONFESSION,
        detail: "5.1",
        text: "God the great Creator of all things doth uphold, direct, dispose, and govern all creatures, actions, and things, from the greatest even to the least, by His most wise and holy providence.",
        note: "The confession’s chapter on providence. The lesson sets Naomi’s cry beside it and does not pretend the confession erases the verse.",
      },
    ],
    review: "Spaced review · due in 6 days",
    xp: "30 XP",
  },
  "ruth-vow": {
    id: "ruth-vow",
    kicker: "Lesson 2 · mastered",
    title: "Ruth's vow",
    excerpt: [
      "Orpah turns back toward Moab. Ruth does not. Her speech binds her to Naomi’s road, Naomi’s people, and Naomi’s God, before anyone has promised her a husband or a field.",
      "One word from that world did not stay put on the quiz: hesed, the loyal love that keeps a bond. The practice step under this lesson is ready for that word. The rest of the path waits until you are done with the field.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "Ruth 1:16",
        text: "And Ruth said, Intreat me not to leave thee, or to return from following after thee: for whither thou goest, I will go; and where thou lodgest, I will lodge: thy people shall be my people, and thy God my God.",
        note: "The vow, in the King James Version, as the lesson cites it.",
      },
      {
        kind: "confession",
        label: CONFESSION,
        detail: "26.1",
        text: "All saints, that are united to Jesus Christ their Head, by His Spirit, and by faith, have fellowship with Him in His graces, sufferings, death, resurrection, and glory.",
        note: "Communion of saints. Ruth joins a people; the confession is about those united to Christ. The lesson keeps those two sentences distinct.",
      },
    ],
    review: "Spaced review · due tomorrow",
    xp: "20 XP",
  },
  "gap-ruth-hesed": {
    id: "gap-ruth-hesed",
    kicker: "Gap lesson · hesed",
    title: "Practice lesson ready",
    excerpt: [
      "This short practice stays on the idea the quiz missed. Hesed is not a mood that passes. In Ruth it is the love that stays: Ruth with Naomi, and the kindness Naomi names in Boaz, toward the living and the dead.",
      "On a signed-in path the practice would end in a few questions drawn from this lesson. Here you can read the excerpt and the sources. Nothing is graded, and nothing is stored.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "Ruth 2:20",
        text: "And Naomi said unto her daughter in law, Blessed be he of the LORD, who hath not left off his kindness to the living and to the dead.",
        note: "Naomi names Boaz’s kindness with the same family of words as Ruth’s loyalty. King James Version.",
      },
      {
        kind: "confession",
        label: CONFESSION,
        detail: "7.3",
        text: "Man, by his fall, having made himself incapable of life by that covenant, the Lord was pleased to make a second, commonly called the covenant of grace.",
        note: "The confession’s name for the bond God keeps. The practice uses it as a retrieved line, not as a sentence the model invented.",
      },
    ],
    review: "Spaced review · ready when you are",
    xp: "40 XP",
  },
  "ruth-field": {
    id: "ruth-field",
    kicker: "Lesson 3 · in progress",
    title: "The field of Boaz",
    excerpt: [
      "Ruth gleans behind the reapers in a field that turns out to be Boaz’s. He has heard what she did for Naomi. He tells the young men not to touch her, and he leaves her water, grain, and a place to work.",
      "The blessing he speaks is a picture. She has come under the wings of the God of Israel. Read that sentence before the later lessons name the redeemer at the gate. This step is the one in progress.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "Ruth 2:12",
        text: "The LORD recompense thy work, and a full reward be given thee of the LORD God of Israel, under whose wings thou art come to trust.",
        note: "Boaz’s blessing over Ruth in his field. King James Version.",
      },
      {
        kind: "confession",
        label: CONFESSION,
        detail: "8.1",
        text: "It pleased God, in His eternal purpose, to choose and ordain the Lord Jesus, His only begotten Son, to be the Mediator between God and man.",
        note: "Of Christ the Mediator. Boaz shelters Ruth; the confession speaks of Christ. The lesson places them side by side and does not swap one for the other.",
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
      "This practice stays on the line the check missed. Boaz does not bless Ruth for a gate or a roof. He blesses her for coming to trust under the wings of the God of Israel.",
      "On a signed-in path, a miss queues a short lesson like this and cites the library. Here the step is a sample. Nothing is graded, and nothing is stored.",
    ],
    citations: [
      {
        kind: "scripture",
        reference: "Ruth 2:12",
        text: "The LORD recompense thy work, and a full reward be given thee of the LORD God of Israel, under whose wings thou art come to trust.",
        note: "Boaz’s blessing in the field, retrieved again for the line this check is about. King James Version.",
      },
      {
        kind: "confession",
        label: CONFESSION,
        detail: "12.1",
        text: "All those that are justified, God vouchsafeth, in and for His only Son Jesus Christ, to make partakers of the grace of adoption, by which they are taken into the number, and enjoy the liberties and privileges of the children of God, have His name put upon them, receive the spirit of adoption, have access to the throne of grace with boldness, are enabled to cry, Abba, Father, are pitied, protected, provided for, and chastened by Him as by a Father.",
        note: "Of Adoption. The practice sets Boaz’s wings beside the confession’s line that the children of God are protected by Him as by a Father. It does not swap Ruth’s verse for the confession.",
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

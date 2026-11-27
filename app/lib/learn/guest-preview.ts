/**
 * Bundled sample path for the signed-out landing.
 * Static on purpose: no D1 read, no session, and nothing to write.
 * Scripture is the King James Version. Confession lines are the Westminster Confession.
 */

import type { PathMapNode } from "./path-map.ts";

export const GUEST_HONESTY_COPY =
  "Lessons and quizzes are AI-generated; Scripture and historical sources are retrieved from the library.";

export const GUEST_PATH_TITLE = "The Book of Ruth";

/** The step a judge sees open when the landing first paints. */
export const GUEST_OPEN_LESSON_ID = "ruth-field";

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
    building: false,
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
    building: false,
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
    building: false,
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
    building: false,
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
    building: false,
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
    building: false,
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
    building: false,
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
};

export function guestLesson(id: string): GuestLessonPreview | null {
  return LESSONS[id] ?? null;
}

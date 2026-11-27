import type { LearnStage, PlanStatus } from "./types.ts";

export type MilestoneId = "outline" | "library" | "lesson-1" | "rest";
export type MilestoneState = "waiting" | "active" | "done";

export type PathMilestone = {
  id: MilestoneId;
  label: string;
  detail: string;
  state: MilestoneState;
};

export type MilestoneInput = {
  stage?: LearnStage;
  status?: PlanStatus;
  lessonsDone: number;
  lessonsTotal: number;
  lessonOneReady: boolean;
};

const PAST_OUTLINE = new Set<LearnStage>(["research", "verify", "review", "teach", "check", "critic", "assemble", "done"]);
const WRITING = new Set<LearnStage>(["teach", "check", "critic", "assemble", "done"]);

/** A core lesson the learner can open: teaching and a quiz, no longer pending. */
export function lessonIsStudyable(lesson: {
  kind?: string;
  status: string;
  teaching: readonly unknown[];
  quiz: readonly unknown[];
}): boolean {
  return lesson.kind !== "gap" && lesson.status !== "pending" && lesson.teaching.length > 0 && lesson.quiz.length > 0;
}

/**
 * Four beats for a path that is still being written.
 * Lesson 1 becomes "done" as soon as it can be studied; the last beat stays active
 * while later lessons finish in the background.
 */
export function pathMilestones(input: MilestoneInput): PathMilestone[] {
  const stage = input.stage;
  const outlined = input.lessonsTotal > 0 || (stage != null && PAST_OUTLINE.has(stage));
  const writing =
    input.lessonOneReady || input.lessonsDone > 0 || (stage != null && WRITING.has(stage));
  const pathBound = input.status === "complete" || input.status === "partial";
  const written = Math.max(input.lessonsDone, input.lessonOneReady ? 1 : 0);
  const remaining = input.lessonsTotal > 0 ? Math.max(0, input.lessonsTotal - written) : 0;

  const outline: PathMilestone = {
    id: "outline",
    label: "Outlining the path",
    detail: outlined ? "The steps are marked." : "Marking the steps before the first lesson is written.",
    state: outlined ? "done" : "active",
  };

  const library: PathMilestone = {
    id: "library",
    label: "Retrieving library passages",
    detail: writing
      ? "Passages, confessions, and the fathers are in hand."
      : "Looking up Scripture, the confessions, and the church fathers.",
    state: !outlined ? "waiting" : writing ? "done" : "active",
  };

  const lesson1: PathMilestone = {
    id: "lesson-1",
    label: "Building Lesson 1",
    detail: input.lessonOneReady ? "Ready to start now." : "Writing the teaching and the check for understanding.",
    state: input.lessonOneReady ? "done" : writing ? "active" : "waiting",
  };

  let restDetail = "The later lessons wait until Lesson 1 can be opened.";
  if (pathBound) restDetail = "The path is bound.";
  else if (input.lessonOneReady && remaining > 1) {
    restDetail = `Lesson 1 is open. ${remaining} lessons are still being written.`;
  } else if (input.lessonOneReady && remaining === 1) {
    restDetail = "Lesson 1 is open. One lesson is still being written.";
  } else if (input.lessonOneReady) {
    restDetail = "Lesson 1 is open. The last pages are being gathered.";
  }

  const rest: PathMilestone = {
    id: "rest",
    label: "Building the remaining lessons",
    detail: restDetail,
    state: pathBound ? "done" : input.lessonOneReady ? "active" : "waiting",
  };

  return [outline, library, lesson1, rest];
}

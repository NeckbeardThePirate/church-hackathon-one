/** Shared Learn pipeline types (client + server). See docs/learn-plan.md §7. */

export const TRADITIONS = [
  "Reformed",
  "Lutheran",
  "Anglican",
  "Catholic",
  "Orthodox",
  "Baptist",
  "Methodist",
  "Pentecostal/charismatic",
] as const;

export type Tradition = (typeof TRADITIONS)[number];
export type Perspective = "neutral" | Tradition;

export function isPerspective(value: unknown): value is Perspective {
  return value === "neutral" || (TRADITIONS as readonly string[]).includes(value as string);
}

export type Complexity = "simple" | "moderate" | "complex";

/** Hard limits per complexity (§3 S1). Code clamps model output to these. */
export const LESSON_BANDS: Record<
  Complexity,
  { min: number; max: number; minutes: [number, number]; quiz: [number, number]; finalItems: number }
> = {
  simple: { min: 1, max: 2, minutes: [15, 30], quiz: [3, 4], finalItems: 0 },
  moderate: { min: 3, max: 5, minutes: [25, 45], quiz: [4, 6], finalItems: 6 },
  complex: { min: 6, max: 10, minutes: [30, 60], quiz: [5, 8], finalItems: 10 },
};

export type PlanStatus = "queued" | "running" | "complete" | "partial" | "failed";

export type LearnStage =
  | "intake"
  | "scope"
  | "plan"
  | "research"
  | "verify"
  | "review"
  | "teach"
  | "check"
  | "critic"
  | "assemble"
  | "done"
  | "error";

/** Teaching block. Mirrors editor BlockType so it maps 1:1 into the editor. */
export type TeachBlock = {
  type: "paragraph" | "heading1" | "heading2" | "bullet" | "numbered" | "quote" | "divider";
  text: string;
};

export type QuizItem = {
  kind: "mc" | "short";
  question: string;
  choices?: string[];
  answer: string;
  rationale: string;
  objectiveIndex: number;
  sourceRef?: string;
};

export type ResourceBase = {
  url: string;
  review: string;
  reviewBasis: "text" | "metadata" | "api";
  perspective?: string;
};
export type VideoResource = ResourceBase & { title: string; channel: string; durationSec?: number; videoId: string };
export type ArticleResource = ResourceBase & { title: string; siteName?: string };
export type BookResource = ResourceBase & {
  title: string;
  authors: string[];
  isbn?: string;
  averageRating?: number;
  ratingsCount?: number;
  year?: number;
};
export type ScriptureReading = { reference: string; text: string; note: string };

/** Output of S1 Scope. */
export type ScopeResult = {
  title: string;
  complexity: Complexity;
  lessonCount: number;
  prerequisites: string[];
  coreConcepts: string[];
  objectives: string[];
  isFaithRelevant: boolean;
};

export type LessonOutline = {
  id: string;
  order: number;
  title: string;
  objectives: string[];
  prerequisiteLessonIds: string[];
  estimatedMinutes: number;
  searchHints: string[];
};

export type LearnLesson = LessonOutline & {
  status: "pending" | "ok" | "degraded";
  teaching: TeachBlock[];
  videos: VideoResource[];
  articles: ArticleResource[];
  books: BookResource[];
  scripture: ScriptureReading[];
  quiz: QuizItem[];
  warnings: string[];
};

export type LearnPlan = {
  id: string;
  topic: string;
  title: string;
  complexity: Complexity;
  perspective: Perspective;
  status: PlanStatus;
  prerequisites: string[];
  objectives: string[];
  lessons: LearnLesson[];
  courseBooks: BookResource[];
  finalAssessment: QuizItem[];
  warnings: string[];
  createdAt: number;
};

export type LearnOptions = {
  perspective: Perspective;
  includeScripture: "auto" | "yes" | "no";
};

/** One line in the live progress feed (§6). */
export type ProgressEvent = {
  seq: number;
  at: number;
  stage: LearnStage;
  lessonId?: string;
  message: string;
};

export type PlanSnapshot = {
  planId: string;
  status: PlanStatus;
  stage: LearnStage;
  lessonsDone: number;
  lessonsTotal: number;
  events: ProgressEvent[];
  plan?: LearnPlan;
  error?: string;
};

/** Sent every few seconds over SSE while a plan is live: proof that work is happening. */
export type Heartbeat = {
  at: number;
  /** Last time a queue consumer touched the plan (stage start/finish, model or Exa call, event). */
  lastActivityAt: number;
  /** Units running right now, keyed "stage:lessonId:rN". */
  active: { key: string; since: number }[];
  calls: { llm: number; exa: number };
  lessonsDone: number;
  lessonsTotal: number;
};

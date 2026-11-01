import type {
  ArticleResource,
  BookResource,
  LearnLesson,
  LearnPlan,
  QuizItem,
  ScriptureReading,
  TeachBlock,
  VideoResource,
} from "./types";
import type { LearnLocation } from "./plan-progress";

export type LearnChatMessage = { role: "user" | "assistant"; content: string };

export type LearnAgentFocus = {
  screen: LearnLocation["screen"];
  lessonId?: string;
  lessonOrder?: number;
  lessonTitle?: string;
};

/** Compact bundle sent to /api/learn/chat — built from the plan the user already has. */
export type LearnChatContext = {
  planId: string;
  topic: string;
  title: string;
  perspective: string;
  complexity: string;
  objectives: string[];
  prerequisites: string[];
  focus: LearnAgentFocus;
  courseBooks?: { title: string; authors: string[]; url: string; review: string }[];
  lessonOutline?: { order: number; title: string; objectives: string[] }[];
  lesson?: SerializedLesson;
  finalQuestions?: { question: string; kind: string }[];
};

export type SerializedLesson = {
  order: number;
  title: string;
  objectives: string[];
  estimatedMinutes: number;
  teaching: string;
  videos: { title: string; url: string; channel?: string; review: string; reviewBasis: string }[];
  articles: { title: string; url: string; siteName?: string; review: string }[];
  books: { title: string; url: string; authors: string[]; review: string }[];
  scripture: { reference: string; text: string; note: string }[];
  library?: { source: string; label: string; detail?: string; text: string; note: string; condemned?: boolean }[];
  quiz: { kind: string; question: string; choices?: string[]; sourceRef?: string }[];
  warnings: string[];
};

export type LearnChatInput = {
  context: LearnChatContext;
  messages?: LearnChatMessage[];
};

const clip = (text: string, max: number) => {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

function teachBlocksToText(blocks: TeachBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "divider") return "---";
      const t = block.text.trim();
      if (!t) return "";
      switch (block.type) {
        case "heading1":
          return `# ${t}`;
        case "heading2":
          return `## ${t}`;
        case "bullet":
          return `- ${t}`;
        case "numbered":
          return `1. ${t}`;
        case "quote":
          return `> ${t}`;
        default:
          return t;
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

function serializeVideo(v: VideoResource) {
  return {
    title: v.title,
    url: v.url,
    channel: v.channel,
    review: clip(v.review, 1200),
    reviewBasis: v.reviewBasis,
  };
}

function serializeArticle(a: ArticleResource) {
  return {
    title: a.title,
    url: a.url,
    siteName: a.siteName,
    review: clip(a.review, 1200),
  };
}

function serializeBook(b: BookResource) {
  return {
    title: b.title,
    url: b.url,
    authors: b.authors,
    review: clip(b.review, 1200),
  };
}

function serializeScripture(s: ScriptureReading) {
  return {
    reference: s.reference,
    text: clip(s.text, 4000),
    note: clip(s.note, 600),
  };
}

function serializeQuizItem(q: QuizItem) {
  return {
    kind: q.kind,
    question: q.question,
    choices: q.choices,
    sourceRef: q.sourceRef,
  };
}

export function serializeLesson(lesson: LearnLesson): SerializedLesson {
  return {
    order: lesson.order,
    title: lesson.title,
    objectives: lesson.objectives,
    estimatedMinutes: lesson.estimatedMinutes,
    teaching: clip(teachBlocksToText(lesson.teaching), 12000),
    videos: lesson.videos.map(serializeVideo),
    articles: lesson.articles.map(serializeArticle),
    books: lesson.books.map(serializeBook),
    scripture: lesson.scripture.map(serializeScripture),
    library: (lesson.library ?? []).map((item) => ({
      source: item.source,
      label: item.label,
      detail: item.detail,
      text: clip(item.text, 1500),
      note: clip(item.note, 400),
      ...(item.condemned ? { condemned: true } : {}),
    })),
    quiz: lesson.quiz.map(serializeQuizItem),
    warnings: lesson.warnings,
  };
}

export function buildLearnChatContext(plan: LearnPlan, location: LearnLocation): LearnChatContext {
  const focus: LearnAgentFocus = { screen: location.screen };
  if (location.screen === "lesson" && location.lessonId) {
    const lesson = plan.lessons.find((l) => l.id === location.lessonId);
    if (lesson) {
      focus.lessonId = lesson.id;
      focus.lessonOrder = lesson.order;
      focus.lessonTitle = lesson.title;
    }
  }

  const base: LearnChatContext = {
    planId: plan.id,
    topic: plan.topic,
    title: plan.title.trim() || plan.topic,
    perspective: plan.perspective,
    complexity: plan.complexity,
    objectives: plan.objectives,
    prerequisites: plan.prerequisites,
    focus,
    courseBooks: plan.courseBooks.length
      ? plan.courseBooks.map((b) => ({
          title: b.title,
          authors: b.authors,
          url: b.url,
          review: clip(b.review, 800),
        }))
      : undefined,
    lessonOutline: plan.lessons.map((l) => ({
      order: l.order,
      title: l.title,
      objectives: l.objectives.slice(0, 6),
    })),
  };

  if (location.screen === "lesson" && location.lessonId) {
    const lesson = plan.lessons.find((l) => l.id === location.lessonId);
    if (lesson) base.lesson = serializeLesson(lesson);
  }

  if (location.screen === "final" && plan.finalAssessment.length) {
    base.finalQuestions = plan.finalAssessment.map((q) => ({
      question: q.question,
      kind: q.kind,
    }));
  }

  return base;
}

export function focusLabel(context: LearnChatContext): string {
  const { focus } = context;
  if (focus.screen === "lesson" && focus.lessonOrder != null && focus.lessonTitle) {
    return `Lesson ${focus.lessonOrder}: ${focus.lessonTitle}`;
  }
  if (focus.screen === "final") return "Final assessment";
  return "Course overview";
}

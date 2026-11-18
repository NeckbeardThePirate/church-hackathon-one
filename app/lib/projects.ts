import { normalizeBlockType, type BlockType } from "./block-types.ts";
import { normalizeLearnProgress, type LearnPlanProgress } from "./learn/plan-progress.ts";
import { lessonKind, type LearnPlan } from "./learn/types.ts";

export type ProjectKind = "learn";

/**
 * Kinds from earlier versions of the app. They still load and display (read-only)
 * so saved data is never lost, but no new project can be created with them.
 */
export type LegacyProjectKind = "lesson" | "study";

export type StoredProjectKind = ProjectKind | LegacyProjectKind;

export type BlockContent = {
  id: string;
  type: BlockType;
  html: string;
  /** Only set on blocks saved by earlier versions; kept so they round-trip untouched. */
  kind?: "text" | "bible-callout" | "deeper" | "page-link";
  bibleReference?: string;
  bibleGatewayUrl?: string;
  /** Legacy payloads, preserved verbatim and never interpreted. */
  deeper?: unknown;
  pageId?: string;
};

export type { BlockType };

export type SourceImage = {
  key: string;
  contentType: string;
  fileName?: string;
};

export type Project = {
  id: string;
  kind: StoredProjectKind;
  title: string;
  blocks: BlockContent[];
  updatedAt: number;
  importComplete: boolean;
  sourceImage?: SourceImage;
  sourceImages?: SourceImage[];
  ocrText?: string;
  rawOcrText?: string;
  /** Set on sub-pages (e.g. a Go Deeper thread converted to a page). */
  parentId?: string;
  /** Learn projects: in-flight plan (resume progress after reload). */
  learnPlanId?: string;
  /** Learn projects: generated plan (docs/learn-plan.md §7). */
  learnPlan?: LearnPlan;
  /** Learn projects: reading + quiz progress for resume. */
  learnProgress?: LearnPlanProgress;
};

export const PROJECT_KIND_LABEL: Record<StoredProjectKind, string> = {
  learn: "Learn path",
  lesson: "Lesson (archived)",
  study: "Study (archived)",
};

/** True for projects saved by earlier versions (lesson/study). These open read-only. */
export function isLegacyProject(project: Pick<Project, "kind">): boolean {
  return project.kind !== "learn";
}

const STORAGE_KEY = "church-hackathon-projects";

function newBlock(type: BlockType = "paragraph", html = ""): BlockContent {
  return { id: crypto.randomUUID(), type, html };
}

export function createBlock(type: BlockType = "paragraph", html = ""): BlockContent {
  return newBlock(type, html);
}

function normalizeBlock(block: Partial<BlockContent> & { id?: string; html?: string }): BlockContent {
  return {
    ...block,
    id: block.id && typeof block.id === "string" ? block.id : crypto.randomUUID(),
    type: normalizeBlockType(block.type),
    html: typeof block.html === "string" ? block.html : "",
  };
}

export function createProject(): Project {
  return {
    id: crypto.randomUUID(),
    kind: "learn",
    title: "",
    blocks: [newBlock()],
    updatedAt: Date.now(),
    importComplete: false,
  };
}

export function defaultTitle(project: Project): string {
  if (project.title.trim()) return project.title.trim();
  return "Untitled path";
}

/**
 * Fill defaults added after a project was saved.
 * Lesson/study archives have neither learnPlan nor learnProgress and are returned as-is.
 * Missing LearnLesson.kind becomes "core". Progress is upgraded to v3.
 */
export function normalizeStoredProject(project: Project): Project {
  if (!project.learnPlan && project.learnProgress == null) return project;
  return {
    ...project,
    ...(project.learnPlan ? { learnPlan: normalizeStoredLearnPlan(project.learnPlan) } : {}),
    ...(project.learnProgress != null ? { learnProgress: normalizeLearnProgress(project.learnProgress) } : {}),
  };
}

function normalizeStoredLearnPlan(plan: LearnPlan): LearnPlan {
  if (!Array.isArray(plan.lessons)) return plan;
  return {
    ...plan,
    lessons: plan.lessons.map((lesson) => {
      if (!lesson || typeof lesson !== "object") return lesson;
      return { ...lesson, kind: lessonKind(lesson) };
    }),
  };
}

function hydrateProject(project: Project): Project {
  return normalizeStoredProject({
    ...project,
    importComplete: project.importComplete ?? true,
    sourceImages: project.sourceImages ?? (project.sourceImage ? [project.sourceImage] : undefined),
    blocks: Array.isArray(project.blocks) ? project.blocks.map((block) => normalizeBlock(block)) : [newBlock()],
  });
}

/** Local notes from before the workspace Durable Object. Does not seed. */
export function readLocalProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Project[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((project) => hydrateProject(project));
  } catch {
    return [];
  }
}

export function clearLocalProjects(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

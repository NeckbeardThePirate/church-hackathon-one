import { normalizeBlockType, type BlockType } from "./block-types";
import type { LearnPlanProgress } from "./learn/plan-progress";
import type { LearnPlan } from "./learn/types";
import type { GoDeeperResult } from "./server/go-deeper";

export type DeeperChatMessage = { role: "user" | "assistant"; content: string };

/** Persisted state of a Go Deeper thread (lives in a `kind: "deeper"` block). */
export type DeeperState = {
  sourceBlockId: string;
  text: string;
  before?: string;
  after?: string;
  collapsed?: boolean;
  data?: GoDeeperResult;
  messages?: DeeperChatMessage[];
};

export type ProjectKind = "lesson" | "study" | "learn";

export type BlockContent = {
  id: string;
  type: BlockType;
  html: string;
  kind?: "text" | "bible-callout" | "deeper" | "page-link";
  bibleReference?: string;
  bibleGatewayUrl?: string;
  /** kind "deeper": the Go Deeper thread. */
  deeper?: DeeperState;
  /** kind "page-link": id of the linked (sub)page. */
  pageId?: string;
};

/** Blocks that are not contentEditable text (callouts, deeper threads, page links). */
export function isNonTextBlock(block: BlockContent): boolean {
  return block.kind === "bible-callout" || block.kind === "deeper" || block.kind === "page-link";
}

export type { BlockType };

export type SourceImage = {
  key: string;
  contentType: string;
  fileName?: string;
};

export type Project = {
  id: string;
  kind: ProjectKind;
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

export const PROJECT_KIND_OPTIONS: {
  kind: ProjectKind;
  label: string;
  description: string;
}[] = [
  {
    kind: "lesson",
    label: "Lesson",
    description: "Plan teaching notes, outlines, and discussion prompts.",
  },
  {
    kind: "study",
    label: "Study",
    description: "Dig into passages, cross-references, and reflections.",
  },
  {
    kind: "learn",
    label: "Learn",
    description: "Build a step-by-step learning plan with lessons, readings, and quizzes.",
  },
];

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  lesson: "Lesson",
  study: "Study",
  learn: "Learn",
};

const STORAGE_KEY = "church-hackathon-projects";

function newBlock(type: BlockType = "paragraph", html = ""): BlockContent {
  return { id: crypto.randomUUID(), type, html };
}

export function createBlock(type: BlockType = "paragraph", html = ""): BlockContent {
  return newBlock(type, html);
}

function normalizeBlock(block: Partial<BlockContent> & { id?: string; html?: string }): BlockContent {
  const normalized: BlockContent = {
    id: block.id && typeof block.id === "string" ? block.id : crypto.randomUUID(),
    type: normalizeBlockType(block.type),
    html: typeof block.html === "string" ? block.html : "",
  };

  if (block.kind === "bible-callout") {
    normalized.kind = "bible-callout";
  } else if (block.kind === "text") {
    normalized.kind = "text";
  } else if (block.kind === "deeper" && block.deeper && typeof block.deeper.text === "string") {
    normalized.kind = "deeper";
    normalized.deeper = block.deeper;
  } else if (block.kind === "page-link" && typeof block.pageId === "string") {
    normalized.kind = "page-link";
    normalized.pageId = block.pageId;
  }

  if (typeof block.bibleReference === "string") normalized.bibleReference = block.bibleReference;
  if (typeof block.bibleGatewayUrl === "string") normalized.bibleGatewayUrl = block.bibleGatewayUrl;

  return normalized;
}

export function createSubpage(parent: Project, title: string, blocks: BlockContent[]): Project {
  return {
    id: crypto.randomUUID(),
    kind: parent.kind,
    title,
    blocks: blocks.length ? blocks : [newBlock()],
    updatedAt: Date.now(),
    importComplete: true,
    parentId: parent.id,
  };
}

export function createProject(kind: ProjectKind): Project {
  return {
    id: crypto.randomUUID(),
    kind,
    title: "",
    blocks: [newBlock()],
    updatedAt: Date.now(),
    importComplete: false,
  };
}

export function defaultTitle(project: Project): string {
  if (project.title.trim()) return project.title.trim();
  return `Untitled ${PROJECT_KIND_LABEL[project.kind]}`;
}

export function seedProjects(): Project[] {
  const now = Date.now();
  return [
    {
      id: "seed-lesson-1",
      kind: "lesson",
      title: "Faith & Works",
      blocks: [{ id: crypto.randomUUID(), type: "paragraph", html: "Opening question for the group…" }],
      updatedAt: now - 1000 * 60 * 60 * 24,
      importComplete: true,
    },
    {
      id: "seed-study-1",
      kind: "study",
      title: "James 2",
      blocks: [{ id: crypto.randomUUID(), type: "paragraph", html: "" }],
      updatedAt: now - 1000 * 60 * 60 * 12,
      importComplete: true,
    },
  ];
}

function hydrateProject(project: Project): Project {
  return {
    ...project,
    importComplete: project.importComplete ?? true,
    sourceImages: project.sourceImages ?? (project.sourceImage ? [project.sourceImage] : undefined),
    blocks: Array.isArray(project.blocks) ? project.blocks.map((block) => normalizeBlock(block)) : [newBlock()],
  };
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

export function loadProjects(): Project[] {
  const stored = readLocalProjects();
  if (stored.length > 0) return stored;
  const seeded = seedProjects();
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  }
  return seeded;
}

export function saveProjects(projects: Project[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

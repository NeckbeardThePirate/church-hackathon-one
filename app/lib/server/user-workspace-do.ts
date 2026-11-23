/**
 * One SQLite Durable Object per Clerk user.
 * Owns notes/projects and small prefs. Learn pipeline state stays on LearnPlanDO.
 */
import { DurableObject } from "cloudflare:workers";
import {
  attemptLessonError,
  mirrorAttemptOntoProgress,
  type LearnAttempt,
} from "../learn/attempts.ts";
import type { ConceptMastery } from "../learn/plan-progress.ts";
import { claimLegacyProgress } from "../learn/plan-progress.ts";
import { scopeFromProject } from "../learn/progress-scope.ts";
import { insertGapLesson, preserveGapLessons } from "../learn/gaps.ts";
import type { LearnLesson } from "../learn/types.ts";
import { normalizeStoredProject, type Project, type StoredProjectKind } from "../projects.ts";
import type { ChatGptIdentity } from "./chatgpt-auth.ts";
import {
  applyWorkspaceMigrations,
  readLearnerStats,
  setLearnerStats as persistLearnerStats,
  type LearnerStats,
  type WorkspaceSql,
} from "./user-workspace-schema.ts";

/** Lesson/study stay valid so projects saved by earlier versions keep loading and saving. */
const KINDS = new Set<StoredProjectKind>(["lesson", "study", "learn"]);

type ProjectRow = {
  id: string;
  payload: string;
};

function withStoredGapLessons(project: Project, stored: Project | null): Project {
  if (!project.learnPlan || !stored?.learnPlan || stored.learnPlan.id !== project.learnPlan.id) return project;
  const lessons = preserveGapLessons(project.learnPlan.lessons, stored.learnPlan.lessons);
  if (lessons.length === project.learnPlan.lessons.length) return project;
  return { ...project, learnPlan: { ...project.learnPlan, lessons } };
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Project>;
  return (
    typeof project.id === "string" &&
    project.id.length > 0 &&
    project.id.length <= 80 &&
    typeof project.kind === "string" &&
    KINDS.has(project.kind as StoredProjectKind) &&
    typeof project.title === "string" &&
    Array.isArray(project.blocks) &&
    typeof project.updatedAt === "number" &&
    typeof project.importComplete === "boolean"
  );
}

export class UserWorkspaceDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      applyWorkspaceMigrations(workspaceSql(this.ctx.storage.sql));
    });
  }

  /** Server-only ChatGPT credential. Never returned by the workspace HTTP API. */
  getOauth(): ChatGptIdentity | null {
    const row = this.ctx.storage.sql.exec<{ payload: string }>("SELECT payload FROM oauth WHERE id = 1").toArray()[0];
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.payload) as ChatGptIdentity;
      if (!parsed || typeof parsed.accessToken !== "string" || typeof parsed.subject !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  setOauth(identity: ChatGptIdentity): void {
    const payload = JSON.stringify(identity);
    if (payload.length > 20_000) throw new Error("OAuth credential is too large.");
    this.ctx.storage.sql.exec(
      `INSERT INTO oauth (id, payload) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      payload,
    );
  }

  clearOauth(): void {
    this.ctx.storage.sql.exec("DELETE FROM oauth WHERE id = 1");
  }

  private readProjects(): Project[] {
    const rows = this.ctx.storage.sql
      .exec<ProjectRow>("SELECT id, payload FROM projects ORDER BY updated_at DESC")
      .toArray();
    const projects: Project[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.payload) as unknown;
        if (isProject(parsed)) projects.push(normalizeStoredProject(parsed));
      } catch {
        // Skip a corrupt row rather than failing the whole workspace.
      }
    }
    return projects;
  }

  listProjects(): Project[] {
    const projects = this.readProjects();
    const claimed = claimLegacyProgress(projects);
    for (const project of claimed) {
      const before = projects.find((item) => item.id === project.id);
      if (!before) continue;
      if (JSON.stringify(before.learnProgress ?? null) === JSON.stringify(project.learnProgress ?? null)) continue;
      this.upsertProject({ ...before, learnProgress: project.learnProgress });
    }
    return claimed;
  }

  /** Project and plan that own attempts for this plan. Null when the plan is not in the workspace yet. */
  learnScopeForPlan(planId: string): { projectId: string; planId: string } | null {
    const project = this.findProjectByLearnPlan(planId);
    return project ? scopeFromProject(project) : null;
  }

  getProject(id: string): Project | null {
    const row = this.ctx.storage.sql
      .exec<ProjectRow>("SELECT id, payload FROM projects WHERE id = ?", id)
      .toArray()[0];
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.payload) as unknown;
      return isProject(parsed) ? normalizeStoredProject(parsed) : null;
    } catch {
      return null;
    }
  }

  ownsProject(id: string): boolean {
    const row = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE id = ?", id)
      .one();
    return row.n > 0;
  }

  findProjectByLearnPlan(planId: string): Project | null {
    if (!planId || planId.length > 80) return null;
    for (const project of this.readProjects()) {
      if (project.learnPlanId === planId || project.learnPlan?.id === planId) return project;
    }
    return null;
  }

  /** Reject an unknown lesson from the project as it is stored right now. */
  previewLearnAttempt(planId: string, attempt: LearnAttempt): { ok: true } | { ok: false; error: string } {
    const error = attemptLessonError(this.findProjectByLearnPlan(planId), attempt);
    return error ? { ok: false, error } : { ok: true };
  }

  /**
   * Re-read the linked project and patch only this attempt's quiz plus a mastery merge.
   * The plan snapshot is unioned by concept id. A lower masteryRev cannot replace a higher one,
   * so two mirrors can commit in either order without dropping a concept.
   * Read and write are synchronous, so a workspace save that already committed is included.
   */
  mirrorLearnAttempt(
    planId: string,
    input: { attempt: LearnAttempt; conceptMastery: Record<string, ConceptMastery>; now: number },
  ): { ok: true } | { ok: false; error: string } {
    const project = this.findProjectByLearnPlan(planId);
    const error = attemptLessonError(project, input.attempt);
    if (error) return { ok: false, error };
    if (!project) return { ok: true };
    const scope = scopeFromProject(project);
    if (!scope) return { ok: true };
    const learnProgress = mirrorAttemptOntoProgress(project.learnProgress, input.attempt, input.conceptMastery, scope);
    const updatedAt = Math.max(project.updatedAt, input.now);
    this.upsertProject({ ...project, learnProgress, updatedAt });
    return { ok: true };
  }

  /**
   * Insert one gap lesson into the project plan, after its parent.
   * Re-reads the row first so a progress save is kept. A missing project is not an error:
   * the plan DO still holds the lesson and the browser save can persist it.
   */
  mergeGapLesson(planId: string, lesson: LearnLesson, now: number): { ok: true } | { ok: false; error: string } {
    const project = this.findProjectByLearnPlan(planId);
    if (!project?.learnPlan) return { ok: true };
    const learnPlan = { ...project.learnPlan, lessons: insertGapLesson(project.learnPlan.lessons, lesson) };
    const updatedAt = Math.max(project.updatedAt, now);
    this.upsertProject({ ...project, learnPlan, updatedAt });
    return { ok: true };
  }

  upsertProject(input: unknown): Project {
    if (!isProject(input)) {
      throw new Error("Invalid project.");
    }
    const stored = this.getProject(typeof (input as { id?: unknown }).id === "string" ? (input as { id: string }).id : "");
    const project = withStoredGapLessons(normalizeStoredProject(input), stored);
    const existing = this.ctx.storage.sql
      .exec<{ updated_at: number }>("SELECT updated_at FROM projects WHERE id = ?", project.id)
      .toArray()[0];
    // A slower request must not overwrite a newer edit of the same note.
    if (existing && existing.updated_at > project.updatedAt) {
      return this.getProject(project.id) ?? project;
    }
    const payload = JSON.stringify(project);
    this.ctx.storage.sql.exec(
      `INSERT INTO projects (id, kind, title, updated_at, import_complete, payload)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         updated_at = excluded.updated_at,
         import_complete = excluded.import_complete,
         payload = excluded.payload`,
      project.id,
      project.kind,
      project.title.slice(0, 500),
      project.updatedAt,
      project.importComplete ? 1 : 0,
      payload,
    );
    return project;
  }

  deleteProject(id: string): void {
    this.ctx.storage.sql.exec("DELETE FROM projects WHERE id = ?", id);
  }

  getPref(key: string): string | null {
    if (!isPrefKey(key)) return null;
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM prefs WHERE key = ?", key)
      .toArray()[0];
    return row?.value ?? null;
  }

  /** Zeros and a null timezone when the learner has no stats row yet. */
  getLearnerStats(): LearnerStats {
    return readLearnerStats(workspaceSql(this.ctx.storage.sql));
  }

  setLearnerStats(input: unknown): LearnerStats {
    return persistLearnerStats(workspaceSql(this.ctx.storage.sql), input);
  }

  setPref(key: string, value: string): void {
    if (!isPrefKey(key)) throw new Error("Invalid preference key.");
    if (value.length > 2000) throw new Error("Preference value is too long.");
    this.ctx.storage.sql.exec(
      `INSERT INTO prefs (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }
}

function isPrefKey(key: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(key);
}

function workspaceSql(sql: DurableObjectState["storage"]["sql"]): WorkspaceSql {
  return {
    exec(query, ...bindings) {
      const cursor = sql.exec(query, ...bindings);
      return {
        one: () => cursor.one(),
        toArray: () => cursor.toArray(),
      };
    },
  };
}

/**
 * One SQLite Durable Object per Clerk user.
 * Owns notes/projects and small prefs. Learn pipeline state stays on LearnPlanDO.
 */
import { DurableObject } from "cloudflare:workers";
import type { Project, ProjectKind } from "@/app/lib/projects";

const KINDS = new Set<ProjectKind>(["lesson", "study", "learn"]);

type ProjectRow = {
  id: string;
  payload: string;
};

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Project>;
  return (
    typeof project.id === "string" &&
    project.id.length > 0 &&
    project.id.length <= 80 &&
    typeof project.kind === "string" &&
    KINDS.has(project.kind as ProjectKind) &&
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
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
          id INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      const version = this.ctx.storage.sql
        .exec<{ version: number }>("SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations")
        .one().version;

      if (version < 1) {
        this.ctx.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            import_complete INTEGER NOT NULL,
            payload TEXT NOT NULL
          )
        `);
        this.ctx.storage.sql.exec(
          "CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects (updated_at DESC)",
        );
        this.ctx.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS prefs (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        `);
        this.ctx.storage.sql.exec("INSERT INTO _sql_schema_migrations (id) VALUES (1)");
      }
    });
  }

  listProjects(): Project[] {
    const rows = this.ctx.storage.sql
      .exec<ProjectRow>("SELECT id, payload FROM projects ORDER BY updated_at DESC")
      .toArray();
    const projects: Project[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.payload) as unknown;
        if (isProject(parsed)) projects.push(parsed);
      } catch {
        // Skip a corrupt row rather than failing the whole workspace.
      }
    }
    return projects;
  }

  getProject(id: string): Project | null {
    const row = this.ctx.storage.sql
      .exec<ProjectRow>("SELECT id, payload FROM projects WHERE id = ?", id)
      .toArray()[0];
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.payload) as unknown;
      return isProject(parsed) ? parsed : null;
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

  upsertProject(input: unknown): Project {
    if (!isProject(input)) {
      throw new Error("Invalid project.");
    }
    const existing = this.ctx.storage.sql
      .exec<{ updated_at: number }>("SELECT updated_at FROM projects WHERE id = ?", input.id)
      .toArray()[0];
    // A slower request must not overwrite a newer edit of the same note.
    if (existing && existing.updated_at > input.updatedAt) {
      return this.getProject(input.id) ?? input;
    }
    const payload = JSON.stringify(input);
    this.ctx.storage.sql.exec(
      `INSERT INTO projects (id, kind, title, updated_at, import_complete, payload)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         updated_at = excluded.updated_at,
         import_complete = excluded.import_complete,
         payload = excluded.payload`,
      input.id,
      input.kind,
      input.title.slice(0, 500),
      input.updatedAt,
      input.importComplete ? 1 : 0,
      payload,
    );
    return input;
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

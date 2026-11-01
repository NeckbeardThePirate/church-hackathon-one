/**
 * LearnPlanDO — one per plan. Coordinator + progress hub (docs/learn-plan.md §6).
 * - Owns plan state, lesson fan-in counting, budgets, idempotency markers.
 * - Streams progress events to clients over SSE.
 * - Deadline alarm forces a partial plan if the pipeline overruns.
 */
import { DurableObject } from "cloudflare:workers";
import type {
  LearnLesson,
  LearnOptions,
  LearnPlan,
  LearnStage,
  LessonOutline,
  Heartbeat,
  PlanSnapshot,
  PlanStatus,
  ProgressEvent,
  ScopeResult,
} from "@/app/lib/learn/types";
import type { LearnEnv, LearnMessage } from "./queues";

export const BUDGET = {
  llm: 120,
  exaPerLesson: 12,
  exaPerPlan: 120,
  wallClockMs: 10 * 60 * 1000,
} as const;

const MAX_EVENTS = 300;
const HEARTBEAT_MS = 4000;
/** A unit running longer than this without finishing is presumed lost (retry will re-add it). */
const STALE_ACTIVE_MS = 5 * 60 * 1000;

type Meta = {
  planId: string;
  userId: string;
  topic: string;
  notes: string;
  options: LearnOptions;
  status: PlanStatus;
  stage: LearnStage;
  createdAt: number;
  round: number;
  spent: { llm: number; exa: number };
  lessonIds: string[];
  pending: string[];
  error?: string;
  deadlineHit?: boolean;
};

type InitInput = { planId: string; userId: string; topic: string; notes: string; options: LearnOptions };

const encoder = new TextEncoder();

export class LearnPlanDO extends DurableObject<LearnEnv> {
  private streams = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  /** Work units currently running (key → startedAt). In memory: only meaningful while the plan is live. */
  private active = new Map<string, number>();
  /** Last time any consumer touched this plan (begin, finish, budget spend, event). */
  private lastActivityAt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private touch(): void {
    this.lastActivityAt = Date.now();
  }

  private async meta(): Promise<Meta> {
    const meta = await this.ctx.storage.get<Meta>("meta");
    if (!meta) throw new Error("Plan not found.");
    return meta;
  }

  private async saveMeta(meta: Meta): Promise<void> {
    await this.ctx.storage.put("meta", meta);
  }

  /* ---------------- lifecycle ---------------- */

  async init(input: InitInput): Promise<boolean> {
    if (await this.ctx.storage.get("meta")) return false;
    const meta: Meta = {
      ...input,
      status: "queued",
      stage: "intake",
      createdAt: Date.now(),
      round: 0,
      spent: { llm: 0, exa: 0 },
      lessonIds: [],
      pending: [],
    };
    await this.saveMeta(meta);
    await this.ctx.storage.setAlarm(meta.createdAt + BUDGET.wallClockMs);
    await this.event("intake", `Queued: ${input.topic.slice(0, 120)}`);
    return true;
  }

  async info(): Promise<{
    userId: string;
    topic: string;
    notes: string;
    options: LearnOptions;
    status: PlanStatus;
    round: number;
    createdAt: number;
    deadlineHit: boolean;
  }> {
    const m = await this.meta();
    return {
      userId: m.userId,
      topic: m.topic,
      notes: m.notes,
      options: m.options,
      status: m.status,
      round: m.round,
      createdAt: m.createdAt,
      deadlineHit: !!m.deadlineHit,
    };
  }

  /** Idempotency: false if this unit of work already finished (at-least-once delivery). */
  async begin(key: string): Promise<boolean> {
    const m = await this.meta();
    if (m.status === "complete" || m.status === "partial" || m.status === "failed") return false;
    if (await this.ctx.storage.get(`done:${key}`)) return false;
    if (m.status === "queued") {
      m.status = "running";
      await this.saveMeta(m);
    }
    this.active.set(key, Date.now());
    this.touch();
    return true;
  }

  async finish(key: string): Promise<void> {
    await this.ctx.storage.put(`done:${key}`, Date.now());
    this.active.delete(key);
    this.touch();
  }

  /** Work unit failed and will be retried by the queue: no longer running right now. */
  async release(key: string): Promise<void> {
    this.active.delete(key);
    this.touch();
  }

  /** Reserve budget before a paid call. Returns false when exhausted. */
  async spend(kind: "llm" | "exa", n = 1): Promise<boolean> {
    const m = await this.meta();
    const cap = kind === "llm" ? BUDGET.llm : BUDGET.exaPerPlan;
    if (m.spent[kind] + n > cap) return false;
    m.spent[kind] += n;
    await this.saveMeta(m);
    this.touch();
    return true;
  }

  /* ---------------- progress ---------------- */

  async event(stage: LearnStage, message: string, lessonId?: string): Promise<void> {
    const events = (await this.ctx.storage.get<ProgressEvent[]>("events")) ?? [];
    const seq = (events.at(-1)?.seq ?? 0) + 1;
    const ev: ProgressEvent = { seq, at: Date.now(), stage, message, ...(lessonId ? { lessonId } : {}) };
    events.push(ev);
    this.touch();
    await this.ctx.storage.put("events", events.slice(-MAX_EVENTS));
    const m = await this.ctx.storage.get<Meta>("meta");
    if (m && stage !== "error" && m.status !== "complete" && m.status !== "partial") {
      m.stage = stage;
      await this.saveMeta(m);
    }
    this.broadcast(`id: ${seq}\nevent: progress\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  private broadcast(chunk: string): void {
    const bytes = encoder.encode(chunk);
    for (const writer of this.streams) {
      writer.write(bytes).catch(() => this.streams.delete(writer));
    }
  }

  private async closeStreams(): Promise<void> {
    const snap = await this.snapshot();
    this.broadcast(`event: done\ndata: ${JSON.stringify(snap)}\n\n`);
    for (const writer of this.streams) writer.close().catch(() => {});
    this.streams.clear();
    this.active.clear();
    this.stopHeartbeat();
  }

  /**
   * Liveness proof for the UI: every few seconds, what is running right now,
   * how long since a consumer last touched the plan, and how many calls have been made.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async heartbeat(): Promise<void> {
    if (this.streams.size === 0) {
      this.stopHeartbeat();
      return;
    }
    const m = await this.ctx.storage.get<Meta>("meta");
    if (!m) return;
    const now = Date.now();
    for (const [key, since] of this.active) if (now - since > STALE_ACTIVE_MS) this.active.delete(key);
    const beat: Heartbeat = {
      at: now,
      lastActivityAt: this.lastActivityAt || m.createdAt,
      active: [...this.active].map(([key, since]) => ({ key, since })),
      calls: { llm: m.spent.llm, exa: m.spent.exa },
      lessonsDone: m.lessonIds.length - m.pending.length,
      lessonsTotal: m.lessonIds.length,
    };
    this.broadcast(`event: heartbeat\ndata: ${JSON.stringify(beat)}\n\n`);
  }

  async snapshot(): Promise<PlanSnapshot> {
    const m = await this.meta();
    const events = (await this.ctx.storage.get<ProgressEvent[]>("events")) ?? [];
    const plan = await this.ctx.storage.get<LearnPlan>("plan");
    return {
      planId: m.planId,
      status: m.status,
      stage: m.stage,
      lessonsTotal: m.lessonIds.length,
      lessonsDone: m.lessonIds.length - m.pending.length,
      events,
      ...(plan ? { plan } : {}),
      ...(m.error ? { error: m.error } : {}),
    };
  }

  /* ---------------- plan data ---------------- */

  async setScope(scope: ScopeResult): Promise<void> {
    await this.ctx.storage.put("scope", scope);
  }

  async getScope(): Promise<ScopeResult | undefined> {
    return this.ctx.storage.get<ScopeResult>("scope");
  }

  async setOutline(outlines: LessonOutline[]): Promise<void> {
    const m = await this.meta();
    for (const outline of outlines) {
      const lesson: LearnLesson = {
        ...outline,
        status: "pending",
        teaching: [],
        videos: [],
        articles: [],
        books: [],
        scripture: [],
        quiz: [],
        warnings: [],
      };
      await this.ctx.storage.put(`lesson:${outline.id}`, lesson);
    }
    m.lessonIds = outlines.map((o) => o.id);
    m.pending = [...m.lessonIds];
    await this.saveMeta(m);
  }

  async getLesson(id: string): Promise<LearnLesson | undefined> {
    return this.ctx.storage.get<LearnLesson>(`lesson:${id}`);
  }

  async getLessons(): Promise<LearnLesson[]> {
    const m = await this.meta();
    const lessons: LearnLesson[] = [];
    for (const id of m.lessonIds) {
      const lesson = await this.ctx.storage.get<LearnLesson>(`lesson:${id}`);
      if (lesson) lessons.push(lesson);
    }
    return lessons.sort((a, b) => a.order - b.order);
  }

  async putLesson(lesson: LearnLesson): Promise<void> {
    await this.ctx.storage.put(`lesson:${lesson.id}`, lesson);
  }

  /** Intermediate stage data (e.g. research candidates) passed between queues by key. */
  async putScratch(key: string, value: unknown): Promise<void> {
    await this.ctx.storage.put(`scratch:${key}`, value);
  }

  async getScratch(key: string): Promise<unknown> {
    return this.ctx.storage.get(`scratch:${key}`);
  }

  /** Fan-in. Returns true exactly once per round, when the last pending lesson finishes. */
  async lessonDone(lessonId: string, round: number): Promise<boolean> {
    const m = await this.meta();
    if (round !== m.round) return false;
    const before = m.pending.length;
    m.pending = m.pending.filter((id) => id !== lessonId);
    await this.saveMeta(m);
    return before > 0 && m.pending.length === 0;
  }

  /** Critic repair: re-open lessons for another round. Returns the new round. */
  async reopen(notes: Record<string, string>): Promise<number> {
    const m = await this.meta();
    m.round += 1;
    m.pending = Object.keys(notes).filter((id) => m.lessonIds.includes(id));
    await this.saveMeta(m);
    await this.ctx.storage.put(`repair:${m.round}`, notes);
    return m.round;
  }

  async repairNote(lessonId: string): Promise<string | undefined> {
    const m = await this.meta();
    if (m.round === 0) return undefined;
    const notes = await this.ctx.storage.get<Record<string, string>>(`repair:${m.round}`);
    return notes?.[lessonId];
  }

  async complete(plan: LearnPlan): Promise<void> {
    const m = await this.meta();
    if (m.status === "complete" || m.status === "partial") return;
    m.status = plan.status === "partial" ? "partial" : "complete";
    m.stage = "done";
    m.pending = [];
    await this.ctx.storage.put("plan", plan);
    await this.saveMeta(m);
    await this.ctx.storage.deleteAlarm();
    const degraded = plan.lessons.filter((l) => l.status === "degraded").length;
    await this.event(
      "done",
      `${plan.lessons.length}/${plan.lessons.length} lessons · ${degraded} degraded · ${plan.warnings.length} warnings`,
    );
    await this.closeStreams();
  }

  async fail(message: string): Promise<void> {
    const m = await this.meta();
    if (m.status === "complete" || m.status === "partial" || m.status === "failed") return;
    m.status = "failed";
    m.error = message;
    await this.saveMeta(m);
    await this.ctx.storage.deleteAlarm();
    await this.event("error", message);
    await this.closeStreams();
  }

  /** Wall-clock budget hit: assemble whatever is finished as a partial plan. */
  async alarm(): Promise<void> {
    const m = await this.ctx.storage.get<Meta>("meta");
    if (!m || m.status === "complete" || m.status === "partial" || m.status === "failed") return;
    m.deadlineHit = true;
    await this.saveMeta(m);
    await this.event("assemble", "Time budget reached; assembling a partial plan.");
    if (m.lessonIds.length === 0) {
      await this.fail("Time budget reached before any lessons were planned.");
      return;
    }
    const msg: LearnMessage = { planId: m.planId, stage: "assemble", round: m.round + 1000 };
    await this.env.LEARN_Q_ASSEMBLE.send(msg);
  }

  /* ---------------- SSE ---------------- */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const after = Number(url.searchParams.get("after") ?? request.headers.get("last-event-id") ?? 0) || 0;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();

    const snap = await this.snapshot();
    const backlog = snap.events
      .filter((ev) => ev.seq > after)
      .map((ev) => `id: ${ev.seq}\nevent: progress\ndata: ${JSON.stringify(ev)}\n\n`)
      .join("");
    writer.write(encoder.encode(`retry: 3000\n\n${backlog}`)).catch(() => {});

    if (snap.status === "complete" || snap.status === "partial" || snap.status === "failed") {
      writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify(snap)}\n\n`)).catch(() => {});
      writer.close().catch(() => {});
    } else {
      this.streams.add(writer);
      this.startHeartbeat();
      void this.heartbeat();
      request.signal?.addEventListener("abort", () => {
        this.streams.delete(writer);
        writer.close().catch(() => {});
      });
    }

    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }
}

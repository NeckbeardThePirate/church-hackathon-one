/**
 * LearnPlanDO — one per plan. Coordinator + progress hub (docs/learn-plan.md §6).
 * - Owns plan state, lesson fan-in counting, budgets, idempotency markers.
 * - Streams progress events to clients over SSE.
 * - Deadline alarm forces a partial plan if the pipeline overruns.
 */
import { DurableObject } from "cloudflare:workers";
import {
  gapTicketIsStale,
  GAP_SITTING_MINUTES,
  insertGapLesson,
  nextGapLessonId,
  practiceTitle,
  selectGapConcepts,
  type GapConcept,
  type GapLessonRef,
  type GapRequest,
  type GapReserveResult,
} from "@/app/lib/learn/gaps";
import {
  normalizeOpenerState,
  planAdaptation,
  type AdaptableLesson,
  type OpenerDiagnostic,
  type OpenerState,
  type OpenerSteer,
} from "@/app/lib/learn/opener";
import {
  LESSON_BANDS,
  lessonKind,
  type GapJobEvent,
  type LearnLesson,
  type LearnOptions,
  type LearnPlan,
  type LearnStage,
  type LessonOutline,
  type Heartbeat,
  type PlanSnapshot,
  type PlanStatus,
  type ProgressEvent,
  type ScopeResult,
  type SourcePassage,
} from "@/app/lib/learn/types";
import type { PassageRef } from "@/app/lib/bible/parse-reference";
import { mergeConceptMastery, type StoredLearnAttempt } from "../../learn/attempts.ts";
import { normalizeLearnProgress, type ConceptMastery } from "../../learn/plan-progress.ts";
import { applyAttemptSchedule, indexMasteryByConcept, preferMasteryRows } from "../../learn/sm2.ts";
import type { LearnEnv, LearnMessage } from "./queues";

export const BUDGET = {
  llm: 120,
  /** Practice lessons use a separate pool so a slower pace does not exhaust the core path budget. */
  gapLlm: 24,
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
  /** Passages the learner chose. Absent on plans started before combined intake. */
  passages?: PassageRef[];
  options: LearnOptions;
  status: PlanStatus;
  stage: LearnStage;
  createdAt: number;
  round: number;
  spent: { llm: number; gapLlm: number; exa: number };
  lessonIds: string[];
  pending: string[];
  error?: string;
  deadlineHit?: boolean;
};

type InitInput = { planId: string; userId: string; topic: string; notes: string; passages?: PassageRef[]; options: LearnOptions };

type GapTicket = {
  lessonId: string;
  sourceLessonId: string;
  sourceConceptIds: string[];
  queuedAt?: number;
};

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
      spent: { llm: 0, gapLlm: 0, exa: 0 },
      lessonIds: [],
      pending: [],
    };
    await this.saveMeta(meta);
    await this.ctx.storage.setAlarm(meta.createdAt + BUDGET.wallClockMs);
    await this.event("intake", `Queued: ${input.topic.slice(0, 120)}`);
    return true;
  }

  async info(): Promise<{
    planId: string;
    userId: string;
    topic: string;
    notes: string;
    passages: PassageRef[];
    options: LearnOptions;
    status: PlanStatus;
    round: number;
    createdAt: number;
    deadlineHit: boolean;
    stage: LearnStage;
    lessonIds: string[];
    lessonsDone: number;
    lessonsTotal: number;
  }> {
    return this.infoFrom(await this.meta());
  }

  private infoFrom(m: Meta) {
    const lessonsTotal = m.lessonIds.length;
    return {
      planId: m.planId,
      userId: m.userId,
      topic: m.topic,
      notes: m.notes,
      passages: m.passages ?? [],
      options: m.options,
      status: m.status,
      round: m.round,
      createdAt: m.createdAt,
      deadlineHit: !!m.deadlineHit,
      stage: m.stage,
      lessonIds: m.lessonIds,
      lessonsDone: lessonsTotal - m.pending.length,
      lessonsTotal,
    };
  }

  /**
   * Idempotency: false if this unit of work already finished (at-least-once delivery).
   * A finished core plan still accepts gap jobs. Those keys start with "gap:" and do not
   * move the plan back to running.
   */
  async begin(key: string): Promise<boolean> {
    const m = await this.meta();
    const gap = key.startsWith("gap:");
    if (!gap && (m.status === "complete" || m.status === "partial" || m.status === "failed")) return false;
    if (await this.ctx.storage.get(`done:${key}`)) return false;
    if (!gap && m.status === "queued") {
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
  async spend(kind: "llm" | "exa", n = 1, opts?: { gap?: boolean }): Promise<boolean> {
    const m = await this.meta();
    if (!this.charge(m, kind, n, opts?.gap)) return false;
    await this.saveMeta(m);
    this.touch();
    return true;
  }

  /**
   * Charge one model call and return the plan owner in the same storage round trip.
   * Gap jobs draw the separate gap pool so a practice lesson cannot drain the core path.
   */
  async reserveLlm(gap = false): Promise<{ ok: boolean; userId: string }> {
    const m = await this.meta();
    if (!this.charge(m, "llm", 1, gap)) return { ok: false, userId: m.userId };
    await this.saveMeta(m);
    this.touch();
    return { ok: true, userId: m.userId };
  }

  private charge(m: Meta, kind: "llm" | "exa", n: number, gap = false): boolean {
    if (kind === "llm" && gap) {
      const spent = m.spent.gapLlm ?? 0;
      if (spent + n > BUDGET.gapLlm) return false;
      m.spent = { ...m.spent, gapLlm: spent + n };
      return true;
    }
    const cap = kind === "llm" ? BUDGET.llm : BUDGET.exaPerPlan;
    if (m.spent[kind] + n > cap) return false;
    m.spent[kind] += n;
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

  /**
   * `events: false` skips the progress log (HTTP clients read that over SSE).
   * `workingPlan: false` skips assembling in-progress lesson bodies. Live SSE
   * only needs status plus the event backlog until the plan is stored.
   */
  async snapshot(options?: { events?: boolean; workingPlan?: boolean }): Promise<PlanSnapshot> {
    const withEvents = options?.events !== false;
    const withWorkingPlan = options?.workingPlan !== false;
    const rows = await this.readMap(withEvents ? ["meta", "events", "plan"] : ["meta", "plan"]);
    const m = rows.get("meta") as Meta | undefined;
    if (!m) throw new Error("Plan not found.");
    const events = withEvents ? ((rows.get("events") as ProgressEvent[] | undefined) ?? []) : [];
    let plan = rows.get("plan") as LearnPlan | undefined;
    // A lesson can be studyable while it is still listed as pending, so this
    // cannot key off `pending`. Empty outlines have nothing to assemble.
    if (!plan && withWorkingPlan && (m.status === "running" || m.status === "queued") && m.lessonIds.length > 0) {
      plan = await this.workingPlanFrom(m);
    }
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

  private async readMap(keys: string[]): Promise<Map<string, unknown>> {
    if (!keys.length) return new Map();
    return this.ctx.storage.get(keys);
  }

  private async writeMap(entries: Record<string, unknown>): Promise<void> {
    if (!Object.keys(entries).length) return;
    await this.ctx.storage.put(entries);
  }

  /** True when at least one core lesson has teach + quiz content the learner can open. */
  private hasStudyableCoreLesson(lessons: LearnLesson[]): boolean {
    return lessons.some(
      (lesson) =>
        lessonKind(lesson) === "core" && lesson.teaching.length > 0 && lesson.quiz.length > 0 && lesson.status !== "pending",
    );
  }

  /**
   * In-progress path for the client while the queue still runs. Does not change meta status.
   * Omits the final assessment until assemble.
   */
  async workingPlanSnapshot(): Promise<LearnPlan | undefined> {
    return this.workingPlanFrom(await this.meta());
  }

  private async workingPlanFrom(m: Meta): Promise<LearnPlan | undefined> {
    const scope = await this.getScope();
    if (!scope) return undefined;
    const lessons = await this.lessonsFor(m);
    if (!this.hasStudyableCoreLesson(lessons)) return undefined;
    return this.planFromParts(m.planId, this.infoFrom(m), scope, lessons, "running");
  }

  async ensureStoredPlan(): Promise<LearnPlan> {
    const stored = await this.ctx.storage.get<LearnPlan>("plan");
    if (stored) return stored;
    const draft = await this.workingPlanSnapshot();
    if (!draft) throw new Error("The path is not ready for practice lessons yet.");
    await this.ctx.storage.put("plan", draft);
    return draft;
  }

  private planFromParts(
    planId: string,
    info: Awaited<ReturnType<LearnPlanDO["info"]>>,
    scope: ScopeResult,
    lessons: LearnLesson[],
    status: PlanStatus,
  ): LearnPlan {
    return {
      id: planId,
      topic: info.topic,
      title: scope.title,
      complexity: scope.complexity,
      perspective: info.options.perspective,
      status,
      prerequisites: scope.prerequisites,
      objectives: scope.objectives,
      lessons,
      courseBooks: [],
      finalAssessment: [],
      warnings: [],
      createdAt: info.createdAt,
    };
  }

  /* ---------------- plan data ---------------- */

  /** Learner passages resolved against the Bible database (text is never model-written). */
  async setSourcePassages(passages: SourcePassage[]): Promise<void> {
    await this.ctx.storage.put("sourcePassages", passages);
  }

  async getSourcePassages(): Promise<SourcePassage[]> {
    return (await this.ctx.storage.get<SourcePassage[]>("sourcePassages")) ?? [];
  }

  async setScope(scope: ScopeResult): Promise<void> {
    await this.ctx.storage.put("scope", scope);
  }

  async getScope(): Promise<ScopeResult | undefined> {
    return this.ctx.storage.get<ScopeResult>("scope");
  }

  async setOutline(outlines: LessonOutline[]): Promise<void> {
    const m = await this.meta();
    const entries: Record<string, LearnLesson> = {};
    for (const outline of outlines) {
      entries[`lesson:${outline.id}`] = lessonShell(outline);
    }
    await this.writeMap(entries);
    m.lessonIds = outlines.map((o) => o.id);
    m.pending = [...m.lessonIds];
    await this.saveMeta(m);
  }

  /**
   * Store the outline, folding in any opener answers that landed while the planner was writing.
   * Research is enqueued by the caller for the returned ids only.
   */
  async commitOutline(outlines: LessonOutline[]): Promise<{ researchIds: string[]; summary: string; note: string }> {
    const scope = await this.getScope();
    const diagnostic = await this.getOpenerDiagnostic();
    const adaptable = outlines.map((outline) => ({ ...outline, pending: true, started: false }));
    const adapted = scope
      ? planAdaptation(adaptable, diagnostic, {
          min: LESSON_BANDS[scope.complexity].min,
          max: LESSON_BANDS[scope.complexity].max,
          minutes: LESSON_BANDS[scope.complexity].minutes[0],
        })
      : { lessons: adaptable, dropIds: [], addIds: [], focusIds: [], note: "" };
    await this.setOutline(adapted.lessons);
    const summary = `${adapted.lessons.length} lessons: ${adapted.lessons.map((lesson) => lesson.title).join(" · ")}`;
    return { researchIds: adapted.lessons.map((lesson) => lesson.id), summary, note: adapted.note };
  }

  async getOpener(): Promise<OpenerState> {
    return normalizeOpenerState(await this.ctx.storage.get("opener"));
  }

  async saveOpener(state: OpenerState): Promise<void> {
    await this.ctx.storage.put("opener", state);
  }

  async mutateOpener(update: (state: OpenerState) => OpenerState): Promise<OpenerState> {
    const next = update(await this.getOpener());
    await this.saveOpener(next);
    return next;
  }

  async getOpenerDiagnostic(): Promise<OpenerDiagnostic> {
    return (await this.getOpener()).diagnostic;
  }

  /**
   * Apply the latest opener diagnostic to lessons that have not started.
   * In-flight lessons are marked so their queue handlers stop cleanly.
   * Returns queue work for the caller. Does not fail the plan.
   */
  async steerFromOpener(): Promise<OpenerSteer> {
    const m = await this.meta();
    const idle = { researchIds: [] as string[], critic: false, round: m.round };
    if (m.status === "complete" || m.status === "partial" || m.status === "failed" || m.lessonIds.length === 0) return idle;
    const scope = await this.getScope();
    if (!scope) return idle;

    const lessons = await this.lessonsFor(m);
    const core = lessons.filter((lesson) => lessonKind(lesson) === "core");
    const adaptable: AdaptableLesson[] = [];
    for (const lesson of core) {
      adaptable.push({
        id: lesson.id,
        order: lesson.order,
        title: lesson.title,
        objectives: lesson.objectives,
        prerequisiteLessonIds: lesson.prerequisiteLessonIds,
        estimatedMinutes: lesson.estimatedMinutes,
        searchHints: lesson.searchHints,
        pending: m.pending.includes(lesson.id),
        started: await this.lessonStarted(lesson, m.round),
      });
    }
    const band = LESSON_BANDS[scope.complexity];
    const adapted = planAdaptation(adaptable, (await this.getOpener()).diagnostic, {
      min: band.min,
      max: band.max,
      minutes: band.minutes[0],
    });
    if (!adapted.dropIds.length && !adapted.addIds.length && !adapted.focusIds.length) return idle;

    const nextIds = adapted.lessons.map((lesson) => lesson.id);
    const nextIdSet = new Set(nextIds);
    for (const id of adapted.dropIds) await this.putScratch(`opener-skip:${id}`, true);
    for (const lesson of adapted.lessons) {
      if (adapted.addIds.includes(lesson.id)) {
        await this.putLesson(lessonShell(lesson));
        continue;
      }
      const existing = await this.getLesson(lesson.id);
      if (!existing) continue;
      const started = existing.status !== "pending" || existing.teaching.length > 0;
      if (started) {
        if (existing.order !== lesson.order || existing.prerequisiteLessonIds.join() !== lesson.prerequisiteLessonIds.join()) {
          await this.putLesson({ ...existing, order: lesson.order, prerequisiteLessonIds: lesson.prerequisiteLessonIds });
        }
        continue;
      }
      await this.putLesson({
        ...existing,
        order: lesson.order,
        title: lesson.title,
        objectives: lesson.objectives,
        prerequisiteLessonIds: lesson.prerequisiteLessonIds,
        estimatedMinutes: lesson.estimatedMinutes,
        searchHints: lesson.searchHints,
      });
    }

    const gaps = m.lessonIds.filter((id) => !core.some((lesson) => lesson.id === id) && !nextIdSet.has(id));
    m.lessonIds = [...nextIds, ...gaps];
    m.pending = [...m.pending.filter((id) => nextIdSet.has(id)), ...adapted.addIds.filter((id) => !m.pending.includes(id))];
    await this.saveMeta(m);
    if (adapted.note) await this.event(m.stage, adapted.note);
    const fresh = await this.meta();
    const critic = fresh.pending.length === 0 && fresh.lessonIds.length > 0 && (fresh.status === "running" || fresh.status === "queued");
    return { researchIds: adapted.addIds, critic, round: fresh.round };
  }

  /**
   * Drop lessons whose research message never made it onto the queue.
   * They must not stay pending, or the path would wait forever.
   */
  async abandonUnqueuedLessons(ids: string[]): Promise<OpenerSteer> {
    const m = await this.meta();
    const drop = new Set(ids);
    for (const id of ids) await this.putScratch(`opener-skip:${id}`, true);
    m.lessonIds = m.lessonIds.filter((id) => !drop.has(id));
    m.pending = m.pending.filter((id) => !drop.has(id));
    await this.saveMeta(m);
    const critic = m.pending.length === 0 && m.lessonIds.length > 0 && (m.status === "running" || m.status === "queued");
    return { researchIds: [], critic, round: m.round };
  }

  private async lessonStarted(lesson: LearnLesson, round: number): Promise<boolean> {
    if (lesson.status !== "pending" || lesson.teaching.length > 0) return true;
    if (await this.ctx.storage.get(`scratch:research:${lesson.id}`)) return true;
    if (await this.ctx.storage.get(`done:research:${lesson.id}:r${round}`)) return true;
    return false;
  }

  async getLesson(id: string): Promise<LearnLesson | undefined> {
    return this.ctx.storage.get<LearnLesson>(`lesson:${id}`);
  }

  async getLessons(): Promise<LearnLesson[]> {
    return this.lessonsFor(await this.meta());
  }

  /** One storage read for every lesson body. Order follows the outline, then core before gap. */
  private async lessonsFor(m: Meta): Promise<LearnLesson[]> {
    if (!m.lessonIds.length) return [];
    const rows = await this.readMap(m.lessonIds.map((id) => `lesson:${id}`));
    const lessons: LearnLesson[] = [];
    for (const id of m.lessonIds) {
      const lesson = rows.get(`lesson:${id}`) as LearnLesson | undefined;
      if (lesson) lessons.push(lesson);
    }
    return lessons.sort((a, b) => a.order - b.order || gapRank(a) - gapRank(b));
  }

  async putLesson(lesson: LearnLesson): Promise<void> {
    await this.ctx.storage.put(`lesson:${lesson.id}`, lesson);
  }

  private async gapTickets(): Promise<GapTicket[]> {
    return (await this.ctx.storage.get<GapTicket[]>("gapTickets")) ?? [];
  }

  private async saveGapTickets(tickets: GapTicket[]): Promise<void> {
    await this.ctx.storage.put("gapTickets", tickets);
  }

  /**
   * Reserve one gap lesson for the concepts that are still uncovered.
   * Does not change plan status. The lesson stays off the stored plan until check finishes.
   */
  async reserveGap(request: GapRequest): Promise<GapReserveResult> {
    const m = await this.meta();
    if (m.status === "failed") {
      return {
        queued: false,
        conceptIds: [],
        skipped: [],
        error: "This path did not finish, so a practice lesson cannot be added.",
      };
    }
    const lessons = await this.lessonsFor(m);
    const tickets = await this.gapTickets();
    if (m.status === "queued" || m.status === "running") {
      const parent = lessons.find((lesson) => lesson.id === request.sourceLessonId);
      if (!parent || lessonKind(parent) === "gap" || !parent.quiz.length) {
        const outlined = m.lessonIds.length > 0;
        return {
          queued: false,
          conceptIds: [],
          skipped: [],
          error: outlined
            ? "That lesson is not ready for practice yet. The rest of the path keeps building in the background."
            : "The path is still being outlined.",
        };
      }
    }
    const known: GapLessonRef[] = [
      ...lessons,
      ...tickets.map((ticket) => ({
        id: ticket.lessonId,
        kind: "gap" as const,
        sourceLessonId: ticket.sourceLessonId,
        sourceConceptIds: ticket.sourceConceptIds,
      })),
    ];
    const selected = selectGapConcepts(known, request.sourceLessonId, request.concepts);
    if (selected.error) {
      return { queued: false, conceptIds: [], skipped: selected.skipped, error: selected.error };
    }
    if (!selected.concepts.length) {
      const wanted = new Set(request.concepts.map((concept) => concept.conceptId));
      const ticket = tickets.find(
        (item) => item.sourceLessonId === request.sourceLessonId && item.sourceConceptIds.some((id) => wanted.has(id)),
      );
      if (ticket && !m.lessonIds.includes(ticket.lessonId)) {
        const pending = await this.getLesson(ticket.lessonId);
        if (!pending?.teaching.length && gapTicketIsStale(ticket.queuedAt, Date.now())) {
          ticket.queuedAt = Date.now();
          await this.saveGapTickets(tickets);
          const parent = lessons.find((lesson) => lesson.id === request.sourceLessonId);
          const labels = request.concepts
            .filter((concept) => ticket.sourceConceptIds.includes(concept.conceptId))
            .map((concept) => concept.conceptLabel)
            .join(", ");
          await this.event("teach", `Practice queued for ${parent?.title ?? "this lesson"}: ${labels}`, ticket.lessonId);
          return {
            queued: true,
            lessonId: ticket.lessonId,
            conceptIds: ticket.sourceConceptIds,
            skipped: selected.skipped,
          };
        }
        return {
          queued: false,
          lessonId: ticket.lessonId,
          conceptIds: ticket.sourceConceptIds,
          skipped: selected.skipped,
        };
      }
      return { queued: false, conceptIds: [], skipped: selected.skipped };
    }

    const parent = lessons.find((lesson) => lesson.id === request.sourceLessonId);
    if (!parent || lessonKind(parent) === "gap") {
      return { queued: false, conceptIds: [], skipped: selected.skipped, error: "Unknown lesson." };
    }
    const used = [...m.lessonIds, ...tickets.map((ticket) => ticket.lessonId)];
    const lessonId = nextGapLessonId(parent.id, used);
    const lesson: LearnLesson = {
      id: lessonId,
      order: parent.order,
      title: practiceTitle(selected.concepts),
      objectives: selected.concepts.map((concept) => `Review ${concept.conceptLabel}`),
      prerequisiteLessonIds: [parent.id],
      estimatedMinutes: GAP_SITTING_MINUTES,
      searchHints: [],
      status: "pending",
      teaching: [],
      videos: [],
      articles: [],
      books: [],
      scripture: [],
      library: [],
      quiz: [],
      warnings: [],
      kind: "gap",
      sourceLessonId: parent.id,
      sourceConceptIds: selected.concepts.map((concept) => concept.conceptId),
    };
    await this.putLesson(lesson);
    await this.putScratch(`gap-concepts:${lessonId}`, selected.concepts);
    tickets.push({
      lessonId,
      sourceLessonId: parent.id,
      sourceConceptIds: lesson.sourceConceptIds ?? [],
      queuedAt: Date.now(),
    });
    await this.saveGapTickets(tickets);
    await this.event("teach", `Practice queued for ${parent.title}: ${selected.concepts.map((concept) => concept.conceptLabel).join(", ")}`, lessonId);
    return {
      queued: true,
      lessonId,
      conceptIds: lesson.sourceConceptIds ?? [],
      skipped: selected.skipped,
    };
  }

  /**
   * Save a finished gap lesson onto the stored plan, after its parent.
   * Plan status stays complete or partial. Returns null when there is nothing to save.
   */
  async commitGapLesson(lesson: LearnLesson): Promise<LearnPlan | null> {
    const m = await this.meta();
    const tickets = await this.gapTickets();
    let stored = await this.ctx.storage.get<LearnPlan>("plan");
    if (!stored) {
      try {
        stored = await this.ensureStoredPlan();
      } catch {
        return null;
      }
    }
    const already = m.lessonIds.includes(lesson.id);
    if (!tickets.some((ticket) => ticket.lessonId === lesson.id) && !already) return null;
    if (already && !tickets.some((ticket) => ticket.lessonId === lesson.id)) {
      this.broadcastGap({ lessonId: lesson.id, plan: stored });
      return stored;
    }

    await this.putLesson(lesson);
    const current = await this.getLessons();
    const mergedLessons = insertGapLesson(current.some((item) => item.id === lesson.id) ? current : [...current, lesson], lesson);
    m.lessonIds = mergedLessons.map((item) => item.id);
    await this.saveMeta(m);
    const plan: LearnPlan = { ...stored, lessons: insertGapLesson(stored.lessons, lesson) };
    await this.ctx.storage.put("plan", plan);
    await this.saveGapTickets(tickets.filter((ticket) => ticket.lessonId !== lesson.id));
    await this.ctx.storage.delete(`scratch:gap-concepts:${lesson.id}`);
    this.broadcastGap({ lessonId: lesson.id, plan });
    return plan;
  }

  /** Drop an unfinished gap job. The stored core plan is left as it was. */
  async abandonGap(lessonId: string, reason: string): Promise<void> {
    const message = reason.trim() || "The practice lesson could not be built. The rest of the path is unchanged.";
    const m = await this.meta();
    const tickets = await this.gapTickets();
    const committed = m.lessonIds.includes(lessonId);
    if (!committed) {
      await this.ctx.storage.delete(`lesson:${lessonId}`);
      await this.ctx.storage.delete(`scratch:gap-concepts:${lessonId}`);
    }
    await this.saveGapTickets(tickets.filter((ticket) => ticket.lessonId !== lessonId));
    await this.event("error", message, lessonId || undefined);
    const plan = await this.ctx.storage.get<LearnPlan>("plan");
    this.broadcastGap({ lessonId, error: message, ...(plan ? { plan } : {}) });
  }

  private broadcastGap(payload: GapJobEvent): void {
    this.broadcast(`event: gap\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  /** Mastery written by the attempt API. Empty until the first submitted attempt. */
  async getConceptMastery(): Promise<Record<string, ConceptMastery>> {
    const stored = await this.ctx.storage.get<unknown>("conceptMastery");
    return normalizeLearnProgress({ conceptMastery: stored ?? {} }).conceptMastery;
  }

  /**
   * Append the attempt and schedule every answered concept in one transaction.
   * SM-2 here is the source of truth. A workspace row reviewed later than the plan row
   * is the base, so an offline review is not applied a second time.
   * Concepts that are not in the attempt keep their scheduling fields.
   */
  async recordLearnAttempt(record: StoredLearnAttempt): Promise<Record<string, ConceptMastery>> {
    if (record.target !== "lesson" && record.target !== "final" && record.target !== "review") {
      throw new Error("Invalid attempt.");
    }
    if (!Array.isArray(record.answers) || record.answers.length < 1 || record.answers.length > 30) {
      throw new Error("Invalid attempt.");
    }
    const attempt = {
      target: record.target,
      ...(record.lessonId ? { lessonId: record.lessonId } : {}),
      answers: record.answers,
    };
    const timeZone = record.timeZone && record.timeZone.length <= 100 ? record.timeZone : "UTC";
    return this.ctx.storage.transactionSync(() => {
      const stored = this.ctx.storage.kv.get<unknown>("conceptMastery");
      const planRows = normalizeLearnProgress({ conceptMastery: stored ?? {} }).conceptMastery;
      const base = preferMasteryRows(planRows, indexMasteryByConcept(record.workspaceMastery));
      const merged = mergeConceptMastery(base, attempt);
      const scheduled = applyAttemptSchedule(merged, attempt, record.at, timeZone);
      const prev = this.ctx.storage.kv.get<unknown>("attempts");
      const attempts = Array.isArray(prev) ? prev : [];
      attempts.push({
        at: record.at,
        target: record.target,
        ...(record.planId ? { planId: record.planId } : {}),
        ...(record.projectId ? { projectId: record.projectId } : {}),
        ...(record.lessonId ? { lessonId: record.lessonId } : {}),
        answers: record.answers,
      });
      this.ctx.storage.kv.put("attempts", attempts.slice(-100));
      this.ctx.storage.kv.put("conceptMastery", scheduled);
      return scheduled;
    });
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

    // Live connections only replay events. Lesson bodies are loaded when a client asks for the plan.
    const snap = await this.snapshot({ workingPlan: false });
    const gapsOpen = (await this.gapTickets()).length > 0;
    const backlog = snap.events
      .filter((ev) => ev.seq > after)
      .map((ev) => `id: ${ev.seq}\nevent: progress\ndata: ${JSON.stringify(ev)}\n\n`)
      .join("");
    writer.write(encoder.encode(`retry: 3000\n\n${backlog}`)).catch(() => {});

    const terminal = snap.status === "complete" || snap.status === "partial" || snap.status === "failed";
    if (terminal && !gapsOpen) {
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

function gapRank(lesson: { kind?: string }): number {
  return lessonKind(lesson) === "gap" ? 1 : 0;
}

function lessonShell(outline: {
  id: string;
  order: number;
  title: string;
  objectives: string[];
  prerequisiteLessonIds: string[];
  estimatedMinutes: number;
  searchHints: string[];
}): LearnLesson {
  return {
    id: outline.id,
    order: outline.order,
    title: outline.title,
    objectives: outline.objectives,
    prerequisiteLessonIds: outline.prerequisiteLessonIds,
    estimatedMinutes: outline.estimatedMinutes,
    searchHints: outline.searchHints,
    status: "pending",
    teaching: [],
    videos: [],
    articles: [],
    books: [],
    scripture: [],
    library: [],
    quiz: [],
    warnings: [],
  };
}

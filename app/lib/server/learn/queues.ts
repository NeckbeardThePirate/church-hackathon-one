/**
 * Queue contract for the Learn pipeline (docs/learn-plan.md §6).
 * One queue per stage. Messages carry IDs only; payloads live in LearnPlanDO.
 */
import type { LearnPlanDO } from "./plan-do";
import type { UserWorkspaceDO } from "../user-workspace-do";
import type { LlmEnv } from "./llm";

export const LEARN_QUEUES = {
  intake: "learn-intake",
  scope: "learn-scope",
  plan: "learn-plan",
  research: "learn-research",
  review: "learn-review",
  teach: "learn-teach",
  check: "learn-check",
  critic: "learn-critic",
  assemble: "learn-assemble",
} as const;

export const LEARN_DLQ = "learn-dlq";

export type QueueStage = keyof typeof LEARN_QUEUES;

export type LearnMessage = {
  planId: string;
  stage: QueueStage;
  lessonId?: string;
  /** Critic repair round. Part of the idempotency key so repairs re-run stages. */
  round: number;
};

export function idempotencyKey(msg: LearnMessage): string {
  return `${msg.stage}:${msg.lessonId ?? "-"}:r${msg.round}`;
}

/** Producer binding name in env for each stage, e.g. LEARN_Q_TEACH. */
export const PRODUCER_BINDING: Record<QueueStage, string> = {
  intake: "LEARN_Q_INTAKE",
  scope: "LEARN_Q_SCOPE",
  plan: "LEARN_Q_PLAN",
  research: "LEARN_Q_RESEARCH",
  review: "LEARN_Q_REVIEW",
  teach: "LEARN_Q_TEACH",
  check: "LEARN_Q_CHECK",
  critic: "LEARN_Q_CRITIC",
  assemble: "LEARN_Q_ASSEMBLE",
};

export function stageForQueue(queueName: string): QueueStage | "dlq" | null {
  if (queueName === LEARN_DLQ) return "dlq";
  for (const [stage, name] of Object.entries(LEARN_QUEUES)) {
    if (name === queueName) return stage as QueueStage;
  }
  return null;
}

export type LearnEnv = LlmEnv & {
  BIBLE?: D1Database;
  SCRIPTURE_VECTORS?: VectorizeIndex;
  /** Exa search + contents. Unset = resource stages are skipped (plan still builds). */
  EXA_API_KEY?: string;
  LEARN_PLAN: DurableObjectNamespace<LearnPlanDO>;
  USER_WORKSPACE: DurableObjectNamespace<UserWorkspaceDO>;
  LEARN_Q_INTAKE: Queue<LearnMessage>;
  LEARN_Q_SCOPE: Queue<LearnMessage>;
  LEARN_Q_PLAN: Queue<LearnMessage>;
  LEARN_Q_RESEARCH: Queue<LearnMessage>;
  LEARN_Q_REVIEW: Queue<LearnMessage>;
  LEARN_Q_TEACH: Queue<LearnMessage>;
  LEARN_Q_CHECK: Queue<LearnMessage>;
  LEARN_Q_CRITIC: Queue<LearnMessage>;
  LEARN_Q_ASSEMBLE: Queue<LearnMessage>;
};

export function planStub(env: LearnEnv, planId: string): DurableObjectStub<LearnPlanDO> {
  return env.LEARN_PLAN.get(env.LEARN_PLAN.idFromName(planId));
}

export async function enqueue(env: LearnEnv, msg: LearnMessage): Promise<void> {
  const queue = (env as unknown as Record<string, Queue<LearnMessage>>)[PRODUCER_BINDING[msg.stage]];
  if (!queue) throw new Error(`Queue binding ${PRODUCER_BINDING[msg.stage]} is missing.`);
  await queue.send(msg);
}

export async function enqueueMany(env: LearnEnv, msgs: LearnMessage[]): Promise<void> {
  if (!msgs.length) return;
  const stage = msgs[0]!.stage;
  const queue = (env as unknown as Record<string, Queue<LearnMessage>>)[PRODUCER_BINDING[stage]];
  if (!queue) throw new Error(`Queue binding ${PRODUCER_BINDING[stage]} is missing.`);
  await queue.sendBatch(msgs.map((body) => ({ body })));
}

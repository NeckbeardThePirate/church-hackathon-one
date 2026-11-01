/**
 * Single queue() entry for every Learn queue. Dispatches on batch.queue.
 * - Per-message ack/retry so one failure does not redeliver the whole batch.
 * - Idempotent: LearnPlanDO.begin() skips work already finished (at-least-once delivery).
 * - Budget exhaustion degrades the lesson instead of retrying.
 * - DLQ: lesson stages degrade the lesson; plan-level stages fail the plan.
 */
import {
  BudgetExhausted,
  finishLesson,
  runAssemble,
  runCheck,
  runCritic,
  runIntake,
  runPlan,
  runResearch,
  runReview,
  runScope,
  runTeach,
} from "./stages";
import {
  enqueue,
  idempotencyKey,
  planStub,
  stageForQueue,
  type LearnEnv,
  type LearnMessage,
  type QueueStage,
} from "./queues";

const HANDLERS: Record<QueueStage, (ctx: Parameters<typeof runIntake>[0]) => Promise<void>> = {
  intake: runIntake,
  scope: runScope,
  plan: runPlan,
  research: runResearch,
  review: runReview,
  teach: runTeach,
  check: runCheck,
  critic: runCritic,
  assemble: runAssemble,
};

const LESSON_STAGES = new Set<QueueStage>(["research", "review", "teach", "check"]);

export function isLearnQueue(queueName: string): boolean {
  return stageForQueue(queueName) !== null;
}

export async function handleLearnBatch(batch: MessageBatch<LearnMessage>, env: LearnEnv): Promise<void> {
  const kind = stageForQueue(batch.queue);
  if (!kind) {
    batch.retryAll();
    return;
  }
  for (const message of batch.messages) {
    try {
      if (kind === "dlq") await handleDeadLetter(env, message.body);
      else await handleOne(env, message.body, message.attempts);
      message.ack();
    } catch (error) {
      console.error(`[learn] ${batch.queue} plan=${message.body?.planId} failed:`, error);
      message.retry({ delaySeconds: Math.min(30, 2 ** message.attempts) });
    }
  }
}

async function handleOne(env: LearnEnv, msg: LearnMessage, attempts: number): Promise<void> {
  const stub = planStub(env, msg.planId);
  const key = idempotencyKey(msg);
  if (!(await stub.begin(key))) return;

  const ctx = { env, msg, stub };
  try {
    await HANDLERS[msg.stage](ctx);
    await stub.finish(key);
  } catch (error) {
    if (error instanceof BudgetExhausted) {
      await stub.finish(key);
      await degradeOrFail(env, msg, error.message);
      return;
    }
    await stub.release(key).catch(() => {});
    if (attempts === 1) {
      const text = error instanceof Error ? error.message : String(error);
      await stub.event(msg.stage, `Retrying: ${text.slice(0, 160)}`, msg.lessonId).catch(() => {});
    }
    throw error;
  }
}

async function handleDeadLetter(env: LearnEnv, msg: LearnMessage): Promise<void> {
  if (!msg?.planId || !msg.stage) return;
  const stub = planStub(env, msg.planId);
  const key = idempotencyKey(msg);
  if (!(await stub.begin(key))) return;
  await stub.finish(key);
  await degradeOrFail(env, msg, `${msg.stage} failed after retries.`);
}

/** Lesson stages degrade the lesson and keep the plan moving; plan stages fail or assemble. */
async function degradeOrFail(env: LearnEnv, msg: LearnMessage, reason: string): Promise<void> {
  const stub = planStub(env, msg.planId);
  const ctx = { env, msg, stub };

  if (LESSON_STAGES.has(msg.stage) && msg.lessonId) {
    const lesson = await stub.getLesson(msg.lessonId);
    if (lesson) {
      await stub.putLesson({
        ...lesson,
        status: "degraded",
        warnings: [...lesson.warnings, reason],
      });
    }
    await stub.event(msg.stage, `L${lesson?.order ?? "?"} degraded: ${reason}`, msg.lessonId);
    await finishLesson(ctx, msg.lessonId);
    return;
  }

  if (msg.stage === "critic") {
    await stub.event("critic", `Review skipped: ${reason}`);
    await enqueue(env, { planId: msg.planId, stage: "assemble", round: msg.round });
    return;
  }

  await stub.fail(`${reason}`);
}

/**
 * Worker entry. Wraps vinext's fetch handler and adds:
 * - queue(): Learn pipeline consumers (all learn-* queues + DLQ)
 * - LearnPlanDO: per-plan coordinator + progress stream
 * - UserWorkspaceDO: one SQLite object per Clerk user (notes + prefs)
 * See docs/learn-plan.md §6.
 */
import vinextHandler from "vinext/server/fetch-handler";
import { handleLearnBatch } from "./app/lib/server/learn/consumer";
import type { LearnEnv, LearnMessage } from "./app/lib/server/learn/queues";

export * from "vinext/server/fetch-handler";
export { LearnPlanDO } from "./app/lib/server/learn/plan-do";
export { UserWorkspaceDO } from "./app/lib/server/user-workspace-do";

const base = vinextHandler as ExportedHandler<LearnEnv>;

export default {
  ...base,
  fetch: base.fetch!.bind(base),
  async queue(batch: MessageBatch<unknown>, env: LearnEnv): Promise<void> {
    await handleLearnBatch(batch as MessageBatch<LearnMessage>, env);
  },
} satisfies ExportedHandler<LearnEnv>;

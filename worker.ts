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
  async fetch(request: Request, env: LearnEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      if (!base.fetch) return new Response("Worker fetch handler is missing.", { status: 500 });
      return await base.fetch(request as Parameters<NonNullable<typeof base.fetch>>[0], env, ctx);
    } catch (error) {
      console.error("[worker] unhandled", error instanceof Error ? error.message : error);
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
      }
      return new Response("Something went wrong.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  },
  async queue(batch: MessageBatch<unknown>, env: LearnEnv): Promise<void> {
    await handleLearnBatch(batch as MessageBatch<LearnMessage>, env);
  },
} satisfies ExportedHandler<LearnEnv>;

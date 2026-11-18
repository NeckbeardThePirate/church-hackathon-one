import { env } from "cloudflare:workers";
import { requireUser } from "../clerk-auth.ts";
import { unownedPlanResponse } from "./access.ts";
import { planStub, type LearnEnv } from "./queues.ts";

const PLAN_ID = /^[0-9a-f-]{36}$/i;

export function learnEnv(): LearnEnv {
  const e = env as unknown as Partial<LearnEnv>;
  if (!e.LEARN_PLAN || !e.LEARN_Q_INTAKE || !e.AI) {
    throw Response.json(
      { error: "Learn bindings are unavailable (LEARN_PLAN, LEARN_Q_*, AI). Restart dev after config changes." },
      { status: 503 },
    );
  }
  return e as LearnEnv;
}

/** Auth + ownership check. Returns the plan stub or an error Response. */
export async function ownedPlan(
  request: Request,
  planId: string,
): Promise<{ stub: ReturnType<typeof planStub>; userId: string } | Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  if (!PLAN_ID.test(planId)) return Response.json({ error: "Invalid plan id" }, { status: 400 });
  let e: LearnEnv;
  try {
    e = learnEnv();
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  const stub = planStub(e, planId);
  const info = await stub.info().catch(() => null);
  const denied = unownedPlanResponse(auth.userId, info);
  if (denied) return denied;
  return { stub, userId: auth.userId };
}

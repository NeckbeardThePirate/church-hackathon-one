import { requireUser } from "@/app/lib/server/clerk-auth";
import { learnEnv } from "@/app/lib/server/learn/api";
import { enqueue, planStub } from "@/app/lib/server/learn/queues";
import { parseIntakeBody } from "@/app/lib/learn/intake";
import { isPerspective, type LearnOptions } from "@/app/lib/learn/types";

export const dynamic = "force-dynamic";

/** Start a Learn plan from any mix of topic, notes, passages and photo text. Enqueues learn-intake; progress streams from /events. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const env = learnEnv();
    const body = (await request.json().catch(() => ({}))) as {
      topic?: unknown;
      notes?: unknown;
      passages?: unknown;
      photos?: unknown;
      options?: { perspective?: unknown; includeScripture?: unknown };
    };

    const intake = parseIntakeBody(body);
    if (!intake.ok) return Response.json({ error: intake.error }, { status: 400 });
    const { topic, notes, passages } = intake;

    const include = body.options?.includeScripture;
    const options: LearnOptions = {
      perspective: isPerspective(body.options?.perspective) ? body.options.perspective : "neutral",
      includeScripture: include === "yes" || include === "no" ? include : "auto",
    };

    const planId = crypto.randomUUID();
    await planStub(env, planId).init({ planId, userId: auth.userId, topic, notes, passages, options });
    await enqueue(env, { planId, stage: "intake", round: 0 });

    return Response.json({ planId, topic }, { status: 202 });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "Could not start plan";
    return Response.json({ error: message }, { status: 500 });
  }
}

import { requireUser } from "@/app/lib/server/clerk-auth";
import { learnEnv } from "@/app/lib/server/learn/api";
import { enqueue, planStub } from "@/app/lib/server/learn/queues";
import { isPerspective, type LearnOptions } from "@/app/lib/learn/types";

export const dynamic = "force-dynamic";

const MAX_TOPIC = 500;
const MAX_NOTES = 20_000;

/** Start a Learn plan. Enqueues learn-intake; progress streams from /events. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const env = learnEnv();
    const body = (await request.json().catch(() => ({}))) as {
      topic?: unknown;
      notes?: unknown;
      options?: { perspective?: unknown; includeScripture?: unknown };
    };

    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (topic.length < 3) return Response.json({ error: "Describe what you want to learn." }, { status: 400 });
    if (topic.length > MAX_TOPIC) return Response.json({ error: `Topic must be under ${MAX_TOPIC} characters.` }, { status: 400 });
    if (notes.length > MAX_NOTES) return Response.json({ error: `Notes must be under ${MAX_NOTES} characters.` }, { status: 400 });

    const include = body.options?.includeScripture;
    const options: LearnOptions = {
      perspective: isPerspective(body.options?.perspective) ? body.options.perspective : "neutral",
      includeScripture: include === "yes" || include === "no" ? include : "auto",
    };

    const planId = crypto.randomUUID();
    await planStub(env, planId).init({ planId, userId: auth.userId, topic, notes, options });
    await enqueue(env, { planId, stage: "intake", round: 0 });

    return Response.json({ planId }, { status: 202 });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "Could not start plan";
    return Response.json({ error: message }, { status: 500 });
  }
}

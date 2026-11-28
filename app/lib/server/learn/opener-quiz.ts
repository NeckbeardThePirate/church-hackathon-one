/**
 * Sequential opener check. The path pipeline never waits on this.
 * A model failure, a timeout, or a skip closes the check and leaves the plan running.
 */
import {
  beginOpenerTurn,
  commitGeneratedQuestion,
  commitOpenerFailure,
  fallbackOpenerQuestion,
  openerUserPrompt,
  parseOpenerQuestion,
  presentOpener,
  promptsRepeat,
  type OpenerAction,
  type OpenerEffect,
  type OpenerPublic,
  type OpenerQuestionDraft,
  type OpenerState,
  type OpenerSteer,
} from "@/app/lib/learn/opener";
import { isGatewayClientError, LEARN_MAX_TOKENS, LEARN_TEXT_MODEL, llmJson, type LlmEnv } from "./llm";

/** Long enough for adaptive thinking at low effort. The path build does not wait on this. */
export const OPENER_TIMEOUT_MS = 45_000;

export const OPENER_SYSTEM = `Write one short familiarity question about ONE specific idea in the learner's topic or passage. Not trivia. Not a verse to recite.
Name that idea in the prompt, the probe, and the concepts. Never write "the main idea" or "a nearby idea".
Each question must be about a different idea from any earlier one.
Return one JSON object and nothing else:
{"prompt":"<question that names the idea>","probe":"<the idea>","stop":false,"choices":[
{"id":"a","label":"<can explain this idea>","reading":"strength","concept":"<the idea>"},
{"id":"b","label":"<has only heard of this idea>","reading":"gap","concept":"<the idea>"},
{"id":"c","label":"<mixes this idea up with a different named idea>","reading":"gap","concept":"<the other idea>"},
{"id":"d","label":"I'm not sure yet","reading":"unsure","concept":"<the idea>"}]}
Exactly 4 choices, ids a b c d. reading is exactly strength, gap, or unsure. Replace every angle-bracket field with real words from the topic or passage. stop is true only on question 3 or later when the pattern is already clear.`;

export type OpenerHost = {
  getOpener(): Promise<OpenerState>;
  mutateOpener(update: (state: OpenerState) => OpenerState | Promise<OpenerState>): Promise<OpenerState>;
  steerFromOpener(): Promise<OpenerSteer>;
  reserveLlm(gap?: boolean): Promise<{ ok: boolean; userId: string }>;
  info(): Promise<{ topic: string; notes: string; planId?: string; passages?: { label?: string }[] }>;
  getSourcePassages(): Promise<{ reference: string; text: string }[]>;
  getScope?(): Promise<{ coreConcepts?: string[] } | undefined>;
  getLessons?(): Promise<{ title?: string; objectives?: string[] }[]>;
};

export type OpenerTurn = {
  body: OpenerPublic;
  steer: OpenerSteer;
};

const EMPTY_STEER: OpenerSteer = { researchIds: [], critic: false, round: 0 };

export async function runOpenerAction(
  env: LlmEnv,
  host: OpenerHost,
  action: OpenerAction,
  options?: { timeoutMs?: number; now?: number },
): Promise<OpenerTurn> {
  const now = options?.now ?? Date.now();
  const event = openerEvent(action);
  const turned = await turn(host, event, now);
  let steer = await steerIfNeeded(host, turned.effects);
  if (!turned.effects.some((effect) => effect.type === "generate")) {
    return { body: presentOpener(turned.state, turned.effects.some((effect) => effect.type === "busy")), steer };
  }

  try {
    const question = await withTimeout(generateOpenerQuestion(env, host), options?.timeoutMs ?? OPENER_TIMEOUT_MS);
    const state = await host.mutateOpener((current) => commitGeneratedQuestion(current, question));
    return { body: presentOpener(state), steer };
  } catch (error) {
    logOpenerGatewayFailure(error);
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[learn] opener check closed:", message);
    const failed = await host.mutateOpener((current) => {
      const committed = commitOpenerFailure(current);
      turned.effects = committed.effects;
      return committed.state;
    });
    steer = mergeSteer(steer, await steerIfNeeded(host, turned.effects));
    return { body: presentOpener(failed), steer };
  }
}

function openerEvent(action: OpenerAction): Parameters<typeof beginOpenerTurn>[1] {
  if (action.type === "answer") return { type: "answer", questionId: action.questionId, choiceId: action.choiceId };
  if (action.type === "skip") return { type: "skip" };
  return { type: "start" };
}

async function generateOpenerQuestion(env: LlmEnv, host: OpenerHost): Promise<OpenerQuestionDraft> {
  const reserved = await host.reserveLlm(false);
  if (!reserved.ok) throw new Error("Opener check skipped: model budget reached.");
  const [info, passages, state, scope, lessons] = await Promise.all([
    host.info(),
    host.getSourcePassages(),
    host.getOpener(),
    host.getScope?.().catch(() => undefined) ?? Promise.resolve(undefined),
    host.getLessons?.().catch(() => []) ?? Promise.resolve([]),
  ]);
  const planId = info.planId ?? "opener";
  const asked = state.questions.map((question) => question.probe);
  const concepts = [
    ...(scope?.coreConcepts ?? []),
    ...lessons.flatMap((lesson) => [lesson.title ?? "", ...(lesson.objectives ?? [])]),
  ];
  const call = {
    role: "worker" as const,
    model: LEARN_TEXT_MODEL,
    system: OPENER_SYSTEM,
    user: openerUserPrompt({
      topic: info.topic,
      notes: info.notes,
      passages: passageContext(info.passages ?? [], passages),
      concepts,
      questions: state.questions,
      answers: state.answers,
    }),
    // The request Haiku 5.5 accepts: adaptive thinking, low effort, the shared token floor.
    // `thinking: disabled` together with output_config.effort is rejected immediately.
    maxTokens: LEARN_MAX_TOKENS,
    effort: "low" as const,
    temperature: 0.4,
    meta: { planId, stage: "opener" },
    userId: reserved.userId,
    validate: (value: unknown) => {
      try {
        const question = parseOpenerQuestion(value);
        if (state.questions.some((prior) => promptsRepeat(prior.prompt, question.prompt) || promptsRepeat(prior.probe, question.probe))) {
          throw new Error("ask about a different idea from the topic or passage");
        }
        return question;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[learn] opener question rejected plan=${planId}: ${message} payload=${JSON.stringify(value).slice(0, 400)}`);
        throw error;
      }
    },
  };
  const fallback = () => {
    const question = fallbackOpenerQuestion({
      topic: info.topic,
      references: (info.passages ?? []).map((passage) => passage.label?.trim() ?? "").filter(Boolean),
      concepts,
      asked,
    });
    console.warn(`[learn] opener fallback question plan=${planId} concept=${question.probe}`);
    return question;
  };
  try {
    return await llmJson(env, call);
  } catch (error) {
    logOpenerGatewayFailure(error);
    if (!openerRequestRejected(error)) return fallback();
    console.warn(`[learn] opener request rejected, retrying without output_config plan=${planId}`);
    try {
      return await llmJson(env, { ...call, effort: "omit" });
    } catch (retryError) {
      logOpenerGatewayFailure(retryError);
      return fallback();
    }
  }
}

function passageContext(
  chosen: { label?: string }[],
  resolved: { reference: string; text: string }[],
): { reference: string; text: string }[] {
  const textByReference = new Map(resolved.filter((passage) => passage.reference.trim()).map((passage) => [passage.reference.trim(), passage.text]));
  const labels = chosen.map((passage) => passage.label?.trim() ?? "").filter(Boolean);
  const references = labels.length ? labels : [...textByReference.keys()];
  return references.map((reference) => ({ reference, text: textByReference.get(reference) ?? "" }));
}

/** A gateway 4xx, including one whose text never says "thinking" or "disabled". */
function openerRequestRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return isGatewayClientError(message) || /\b4\d\d\b/.test(message);
}

/** Workers logs: gateway status and the first 500 characters of the body. */
export function logOpenerGatewayFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/Anthropic via gateway: (\d{3})(?:\s([\s\S]*))?/);
  const status = match?.[1] ?? "unknown";
  const body = (match?.[2] ?? message).replace(/\s+/g, " ").trim().slice(0, 500);
  console.warn(`[learn] opener gateway failure status=${status} body=${body}`);
}

async function turn(
  host: OpenerHost,
  event: Parameters<typeof beginOpenerTurn>[1],
  now: number,
): Promise<{ state: OpenerState; effects: OpenerEffect[] }> {
  let effects: OpenerEffect[] = [];
  const state = await host.mutateOpener((current) => {
    const next = beginOpenerTurn(current, event, now);
    effects = next.effects;
    return next.state;
  });
  return { state, effects };
}

async function steerIfNeeded(host: OpenerHost, effects: OpenerEffect[]): Promise<OpenerSteer> {
  if (!effects.some((effect) => effect.type === "steer")) return EMPTY_STEER;
  try {
    return await host.steerFromOpener();
  } catch (error) {
    console.warn("[learn] opener steer skipped:", error instanceof Error ? error.message : error);
    return EMPTY_STEER;
  }
}

function mergeSteer(left: OpenerSteer, right: OpenerSteer): OpenerSteer {
  return {
    researchIds: [...new Set([...left.researchIds, ...right.researchIds])],
    critic: left.critic || right.critic,
    round: right.researchIds.length || right.critic ? right.round : left.round,
  };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Opener check timed out.")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

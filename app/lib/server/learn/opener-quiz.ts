/**
 * Sequential opener check. The path pipeline never waits on this.
 * A model failure, a timeout, or a skip closes the check and leaves the plan running.
 */
import {
  beginOpenerTurn,
  commitGeneratedQuestion,
  commitOpenerFailure,
  openerUserPrompt,
  parseOpenerQuestion,
  presentOpener,
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

export const OPENER_SYSTEM = `One short familiarity question. Not trivia. Not a verse to recite.
Return only this JSON object:
{"prompt":"How familiar is the main idea?","probe":"the main idea","stop":false,"choices":[
{"id":"a","label":"I can explain it","reading":"strength","concept":"the main idea"},
{"id":"b","label":"I have only heard of it","reading":"gap","concept":"the main idea"},
{"id":"c","label":"I mix it up with a nearby idea","reading":"gap","concept":"a nearby idea"},
{"id":"d","label":"I'm not sure yet","reading":"unsure","concept":"the main idea"}]}
Exactly 4 choices, ids a b c d. reading is the single word strength, gap, or unsure. The last choice is unsure and says "I'm not sure yet". stop is false until question 3 or later already shows a pattern.`;

export type OpenerHost = {
  getOpener(): Promise<OpenerState>;
  mutateOpener(update: (state: OpenerState) => OpenerState | Promise<OpenerState>): Promise<OpenerState>;
  steerFromOpener(): Promise<OpenerSteer>;
  reserveLlm(gap?: boolean): Promise<{ ok: boolean; userId: string }>;
  info(): Promise<{ topic: string; notes: string; planId?: string }>;
  getSourcePassages(): Promise<{ reference: string; text: string }[]>;
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
  const [info, passages, state] = await Promise.all([host.info(), host.getSourcePassages(), host.getOpener()]);
  const planId = info.planId ?? "opener";
  const call = {
    role: "worker" as const,
    model: LEARN_TEXT_MODEL,
    system: OPENER_SYSTEM,
    user: openerUserPrompt({
      topic: info.topic,
      notes: info.notes,
      passages,
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
        return parseOpenerQuestion(value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[learn] opener question rejected plan=${planId}: ${message} payload=${JSON.stringify(value).slice(0, 400)}`);
        throw error;
      }
    },
  };
  try {
    return await llmJson(env, call);
  } catch (error) {
    logOpenerGatewayFailure(error);
    if (!openerRequestRejected(error)) throw error;
    console.warn(`[learn] opener request rejected, retrying without output_config plan=${planId}`);
    return await llmJson(env, { ...call, effort: "omit" });
  }
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

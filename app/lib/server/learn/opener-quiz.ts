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
import { LEARN_TEXT_MODEL, llmJson, type LlmEnv } from "./llm";

export const OPENER_TIMEOUT_MS = 18_000;

const OPENER_SYSTEM = `You write one short diagnostic question for a learner starting a study path.
Probe baseline familiarity and knowledge gaps. This is not trivia and not a graded exam.
Use the topic, the learner's notes, the passages, and every earlier answer.
Return JSON:
{"prompt":"one question under 180 characters","probe":"the concept this question tests, 2-6 words","stop":false,
 "choices":[{"id":"a","label":"under 90 characters","reading":"strength"|"gap"|"unsure","concept":"2-6 words"}]}
Rules:
- Exactly 4 choices. One reading "strength" (they already grasp the idea). One reading "gap" (a beginner answer or a plausible mix-up). One more strength or gap that distinguishes depth. One reading "unsure" with label "I'm not sure yet" and concept equal to probe.
- Choice ids are a, b, c, and d.
- stop is true only when this is question 3 or later and the earlier answers already show a clear pattern. Otherwise false.
- Do not quote Bible verses, confession text, or church fathers. You may name a reference.
- Do not ask the learner to recite a passage.`;

export type OpenerHost = {
  getOpener(): Promise<OpenerState>;
  mutateOpener(update: (state: OpenerState) => OpenerState): Promise<OpenerState>;
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
    console.warn("[learn] opener check closed:", error instanceof Error ? error.message : error);
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
  return llmJson(env, {
    role: "worker",
    model: LEARN_TEXT_MODEL,
    system: OPENER_SYSTEM,
    user: openerUserPrompt({
      topic: info.topic,
      notes: info.notes,
      passages,
      questions: state.questions,
      answers: state.answers,
    }),
    maxTokens: 800,
    temperature: 0.4,
    meta: { planId: info.planId ?? "opener", stage: "opener" },
    userId: reserved.userId,
    validate: parseOpenerQuestion,
  });
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

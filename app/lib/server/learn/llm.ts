/**
 * The only place the Learn pipeline calls a model. Every call routes through
 * Cloudflare AI Gateway (docs/learn-plan.md §4).
 *
 * Model per role comes from env, so the gateway config can change models
 * without code changes:
 *   LEARN_MODEL_PLANNER  (scope, plan, critic)   default: Workers AI glm
 *   LEARN_MODEL_WORKER   (teach, quiz, check)    default: Workers AI glm
 * Prefix "anthropic/" (e.g. "anthropic/claude-sonnet-5-5") routes to Anthropic
 * through the gateway's Anthropic provider; anything else is a Workers AI model id.
 */
import { parseWorkersAiText } from "../ocr";
/** Default Workers AI text model for Learn stages and the tutor chat. */
export const LEARN_TEXT_MODEL = "@cf/zai-org/glm-5.3-flash";
import { extractJson } from "./json-text";
import { mockModelText } from "./mock-llm";

export type LlmRole = "planner" | "worker";

export type LlmEnv = {
  AI: Ai;
  AI_GATEWAY_ID?: string;
  LEARN_MODEL_PLANNER?: string;
  LEARN_MODEL_WORKER?: string;
  ANTHROPIC_API_KEY?: string;
  AI_GATEWAY_TOKEN?: string;
  /** "1" only in local dev. Production must leave this unset. */
  MOCK_AI?: string;
  /** Optional Responses API model used with a user's ChatGPT plan after Workers AI fails. */
  LEARN_CHATGPT_MODEL?: string;
  USER_WORKSPACE?: DurableObjectNamespace;
};

export type LlmMeta = { planId: string; stage: string; lessonId?: string };

type JsonCall<T> = {
  role: LlmRole;
  system: string;
  user: string;
  meta: LlmMeta;
  maxTokens?: number;
  temperature?: number;
  /** Throw to reject the output; the message is fed back to the model on retry. */
  validate: (value: unknown) => T;
  /** Plan owner. Used only to look up a stored ChatGPT token for fallback compute. */
  userId?: string;
};

const MAX_ATTEMPTS = 3;

function modelFor(env: LlmEnv, role: LlmRole): string {
  const configured = role === "planner" ? env.LEARN_MODEL_PLANNER : env.LEARN_MODEL_WORKER;
  return configured?.trim() || LEARN_TEXT_MODEL;
}

function gatewayOptions(env: LlmEnv, meta: LlmMeta, attempt: number): GatewayOptions | undefined {
  if (!env.AI_GATEWAY_ID) return undefined;
  return {
    id: env.AI_GATEWAY_ID,
    // Retries must not hit a cached bad answer.
    skipCache: attempt > 1,
    metadata: { planId: meta.planId, stage: meta.stage, lessonId: meta.lessonId ?? null, attempt },
  };
}

let warnedNoGateway = false;
let warnedGatewayAuth = false;

function isGatewayAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /401|403|unauthorized|authentication|cf-aig/i.test(message);
}

async function runWorkers(
  env: LlmEnv,
  model: string,
  system: string,
  user: string,
  meta: LlmMeta,
  attempt: number,
  maxTokens: number,
  temperature: number,
  gateway: GatewayOptions | undefined,
): Promise<string> {
  const result = await env.AI.run(
    model as Parameters<Ai["run"]>[0],
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      max_tokens: maxTokens,
      temperature,
    } as never,
    gateway ? ({ gateway } as never) : undefined,
  );
  return parseWorkersAiText(result);
}

async function complete(
  env: LlmEnv,
  model: string,
  system: string,
  user: string,
  meta: LlmMeta,
  attempt: number,
  maxTokens: number,
  temperature: number,
  userId?: string,
): Promise<string> {
  if (env.MOCK_AI === "1") return mockModelText(system, user, meta);

  if (!env.AI_GATEWAY_ID && !warnedNoGateway) {
    warnedNoGateway = true;
    console.warn("[learn] AI_GATEWAY_ID is not set; model calls bypass AI Gateway.");
  }

  if (model.startsWith("anthropic/")) {
    if (!env.AI_GATEWAY_ID) throw new Error("Anthropic models require AI_GATEWAY_ID.");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    // Omit when the gateway stores the provider key (BYOK).
    if (env.ANTHROPIC_API_KEY) headers["x-api-key"] = env.ANTHROPIC_API_KEY;
    if (env.AI_GATEWAY_TOKEN) headers["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
    const res = (await env.AI.gateway(env.AI_GATEWAY_ID).run({
      provider: "anthropic",
      endpoint: "v1/messages",
      headers,
      query: {
        model: model.slice("anthropic/".length),
        max_tokens: maxTokens,
        temperature,
        system: `${system}\nReturn ONLY one JSON object. No prose, no code fences.`,
        messages: [{ role: "user", content: user }],
      },
    })) as Response;
    if (!res.ok) throw new Error(`Anthropic via gateway: ${res.status} ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (body.content ?? []).map((part) => part.text ?? "").join("").trim();
  }

  const gateway = gatewayOptions(env, meta, attempt);
  try {
    return await runWorkers(env, model, system, user, meta, attempt, maxTokens, temperature, gateway);
  } catch (error) {
    if (gateway && isGatewayAuthError(error)) {
      if (!warnedGatewayAuth) {
        warnedGatewayAuth = true;
        console.warn("[learn] AI Gateway rejected the call; retrying on Workers AI directly.");
      }
      try {
        return await runWorkers(env, model, system, user, meta, attempt, maxTokens, temperature, undefined);
      } catch (directError) {
        return chatGptOrThrow(env, userId, system, user, maxTokens, directError);
      }
    }
    return chatGptOrThrow(env, userId, system, user, maxTokens, error);
  }
}

async function chatGptOrThrow(
  env: LlmEnv,
  userId: string | undefined,
  system: string,
  user: string,
  maxTokens: number,
  error: unknown,
): Promise<string> {
  if (!userId || !env.LEARN_CHATGPT_MODEL?.trim() || !env.USER_WORKSPACE) throw error;
  const { chatGptText } = await import("../chatgpt-compute");
  const text = await chatGptText(env, userId, system, user, maxTokens);
  if (!text) throw error;
  return text;
}

export { extractJson };

/** JSON call with schema validation and up to 2 corrective retries (§3). */
export async function llmJson<T>(env: LlmEnv, call: JsonCall<T>): Promise<T> {
  const model = modelFor(env, call.role);
  let user = call.user;
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await complete(
        env,
        model,
        call.system,
        user,
        call.meta,
        attempt,
        call.maxTokens ?? 4096,
        call.temperature ?? 0.3,
        call.userId,
      );
      return call.validate(extractJson(raw));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      user = `${call.user}\n\nYour previous answer was rejected: ${lastError}\nReturn corrected JSON only.`;
    }
  }
  throw new Error(`${call.meta.stage}: model output invalid after ${MAX_ATTEMPTS} attempts (${lastError})`);
}

/* ---------- tiny validation helpers (no zod dependency) ---------- */

export function obj(value: unknown, path = "root"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

export function str(value: unknown, path: string, { optional = false } = {}): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (optional) return "";
  throw new Error(`${path} must be a non-empty string`);
}

export function list(value: unknown, path: string, { min = 0 } = {}): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length < min) throw new Error(`${path} needs at least ${min} items`);
  return value;
}

export function strList(value: unknown, path: string, opts: { min?: number } = {}): string[] {
  return list(value ?? [], path, opts)
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

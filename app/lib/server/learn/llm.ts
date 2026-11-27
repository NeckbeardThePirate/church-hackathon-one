/**
 * The only place the Learn pipeline calls a model. Every call routes through
 * Cloudflare AI Gateway (docs/learn-plan.md §4).
 *
 * Model per role comes from env, so the gateway config can change models
 * without code changes:
 *   LEARN_MODEL_PLANNER  (scope, plan, critic)   default: Claude Haiku 5.5
 *   LEARN_MODEL_WORKER   (teach, quiz, check)    default: Claude Haiku 5.5
 * Prefix "anthropic/" (catalog id `anthropic/claude-haiku-5.5`) routes to
 * Anthropic through the gateway's Anthropic provider. The provider-native
 * messages name drops the prefix and turns dots into hyphens (`claude-haiku-5-5`).
 * Anything else is a Workers AI model id.
 */
import { isGatewayAuthError } from "../ai-gateway.ts";
import { parseWorkersAiText } from "../ocr.ts";
import { extractJson } from "./json-text.ts";
import { mockModelText } from "./mock-llm.ts";

/**
 * AI Gateway catalog id for Claude Haiku 5.5.
 * https://developers.cloudflare.com/ai/models/anthropic/claude-haiku-5.5/
 */
export const LEARN_TEXT_MODEL = "anthropic/claude-haiku-5.5";

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

/** Anthropic effort. Low keeps a short check from spending the output budget on thinking. */
export type LlmEffort = "low" | "medium" | "high";

type JsonCall<T> = {
  role: LlmRole;
  /** Catalog id. The opener check pins {@link LEARN_TEXT_MODEL}; other stages use the role default. */
  model?: string;
  system: string;
  user: string;
  meta: LlmMeta;
  maxTokens?: number;
  temperature?: number;
  /** Sent as `output_config.effort` on Anthropic messages. Omitted for Workers AI. */
  effort?: LlmEffort;
  /** Throw to reject the output; the message is fed back to the model on retry. */
  validate: (value: unknown) => T;
  /** Plan owner. Used only to look up a stored ChatGPT token for fallback compute. */
  userId?: string;
};

const MAX_ATTEMPTS = 3;

/** Model id for a role. Empty or whitespace vars use {@link LEARN_TEXT_MODEL}. */
export function learnModelId(env: Pick<LlmEnv, "LEARN_MODEL_PLANNER" | "LEARN_MODEL_WORKER">, role: LlmRole): string {
  const configured = role === "planner" ? env.LEARN_MODEL_PLANNER : env.LEARN_MODEL_WORKER;
  return configured?.trim() || LEARN_TEXT_MODEL;
}

/**
 * Catalog id → Anthropic Messages model name.
 * `anthropic/claude-haiku-5.5` becomes `claude-haiku-5-5`.
 */
export function anthropicProviderModel(model: string): string {
  const slug = model.startsWith("anthropic/") ? model.slice("anthropic/".length) : model;
  return slug.replaceAll(".", "-");
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
  effort?: LlmEffort,
): Promise<string> {
  if (env.MOCK_AI === "1") return mockModelText(system, user, meta);

  if (!env.AI_GATEWAY_ID && !warnedNoGateway) {
    warnedNoGateway = true;
    console.warn("[learn] AI_GATEWAY_ID is not set; model calls bypass AI Gateway.");
  }

  if (model.startsWith("anthropic/")) {
    // Haiku 5.5's messages schema has no temperature (newer Claude models reject it).
    // Thinking tokens count against max_tokens. A low effort keeps a short JSON check
    // from spending the whole budget before the answer is written.
    const query: Record<string, unknown> = {
      max_tokens: maxTokens,
      system: `${system}\nReturn ONLY one JSON object. No prose, no code fences.`,
      messages: [{ role: "user", content: user }],
    };
    if (effort) query.output_config = { effort };
    const result = await callAnthropic(env, model, query, attempt > 1 ? { "cf-aig-skip-cache": "true" } : undefined);
    return readAnthropicText(result);
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
  const { chatGptText } = await import("../chatgpt-compute.ts");
  const text = await chatGptText(env, userId, system, user, maxTokens);
  if (!text) throw error;
  return text;
}

export { extractJson };

/** Anthropic Messages through AI Gateway (`provider: anthropic`, `v1/messages`). */
export async function callAnthropic(
  env: LlmEnv,
  model: string,
  query: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const gatewayId = env.AI_GATEWAY_ID?.trim();
  if (!gatewayId) throw new Error("Anthropic models require AI_GATEWAY_ID.");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    ...extraHeaders,
  };
  // Omit when the gateway stores the provider key (BYOK) or uses Unified Billing.
  const providerKey = env.ANTHROPIC_API_KEY?.trim();
  if (providerKey) headers["x-api-key"] = providerKey;
  const gatewayToken = env.AI_GATEWAY_TOKEN?.trim();
  if (gatewayToken) headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
  return env.AI.gateway(gatewayId).run({
    provider: "anthropic",
    endpoint: "v1/messages",
    headers,
    query: { ...query, model: anthropicProviderModel(model) },
  });
}

export async function readAnthropicText(result: unknown): Promise<string> {
  if (typeof Response !== "undefined" && result instanceof Response) {
    if (!result.ok) {
      const detail = (await result.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500);
      throw new Error(`Anthropic via gateway: ${result.status}${detail ? ` ${detail}` : ""}`);
    }
    const payload = await result.json().catch(() => null);
    const text = parseWorkersAiText(payload);
    if (!text) throw missingAnthropicText(payload);
    return text;
  }
  const text = parseWorkersAiText(result);
  if (!text) throw missingAnthropicText(result);
  return text;
}

function missingAnthropicText(payload: unknown): Error {
  const stop =
    payload && typeof payload === "object" && typeof (payload as { stop_reason?: unknown }).stop_reason === "string"
      ? (payload as { stop_reason: string }).stop_reason
      : "";
  return new Error(`Anthropic via gateway returned no text${stop ? ` (stop_reason: ${stop})` : ""}.`);
}

/** JSON call with schema validation and up to 2 corrective retries (§3). */
export async function llmJson<T>(env: LlmEnv, call: JsonCall<T>): Promise<T> {
  const model = call.model?.trim() || learnModelId(env, call.role);
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
        call.effort,
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

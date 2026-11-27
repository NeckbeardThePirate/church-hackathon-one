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
 *
 * Haiku 5.5 thinks by default, and those thinking tokens count against
 * `max_tokens`. A small budget can stop after the thinking block and return
 * no answer. Every call uses {@link LEARN_MAX_TOKENS} unless a caller passes
 * {@link LEARN_MAX_TOKENS_LONG}, and effort {@link LEARN_THINKING_EFFORT} so
 * thinking stays short enough to leave room for the answer.
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

/**
 * Shared output budget for every model call. Haiku 5.5's thinking tokens
 * come out of this number, so the floor stays high enough for an answer.
 * Future callers that omit `maxTokens` inherit it.
 */
export const LEARN_MAX_TOKENS = 8_000;

/** Lessons, practice lessons, and the path outline. Under Haiku 5.5's 128k output cap. */
export const LEARN_MAX_TOKENS_LONG = 16_000;

/** Provider output cap for Claude Haiku 5.5. Requests above this are rejected. */
export const LEARN_MAX_TOKENS_LIMIT = 128_000;

/**
 * Adaptive thinking is on by default. `low` is the effort that skips or
 * shortens thinking so it cannot use up the answer. `budget_tokens` is not
 * valid on Haiku 5.5 (the API returns 400).
 */
export const LEARN_THINKING_EFFORT = "low" as const;

/**
 * Ceiling for one non-streaming generation. A full 16k reply still fits;
 * the model stops at `end_turn` as soon as the answer is done. Streaming
 * waits only until the first byte, then keeps the connection open.
 */
export const LEARN_GATEWAY_TIMEOUT_MS = 240_000;

/** Raise a too-small budget to the shared floor, and stay inside the model cap. */
export function resolveMaxTokens(requested?: number): number {
  const numeric = typeof requested === "number" && Number.isFinite(requested) ? requested : LEARN_MAX_TOKENS;
  return Math.min(LEARN_MAX_TOKENS_LIMIT, Math.max(LEARN_MAX_TOKENS, Math.floor(numeric)));
}

/**
 * Anthropic Messages body for Haiku 5.5. Thinking is adaptive. Effort stays
 * at {@link LEARN_THINKING_EFFORT} unless the caller already set one.
 * Temperature is omitted because current Claude models reject it.
 */
export function anthropicRequestQuery(query: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...query };
  delete next.temperature;
  const requested = typeof next.max_tokens === "number" ? next.max_tokens : undefined;
  next.max_tokens = resolveMaxTokens(requested);
  next.thinking = { type: "adaptive" };
  const configured = next.output_config;
  const effort =
    configured && typeof configured === "object" && typeof (configured as { effort?: unknown }).effort === "string"
      ? (configured as { effort: string }).effort
      : LEARN_THINKING_EFFORT;
  next.output_config = { effort };
  return next;
}

function readStopReason(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.stop_reason === "string") return record.stop_reason;
  const delta = record.delta;
  if (delta && typeof delta === "object" && typeof (delta as Record<string, unknown>).stop_reason === "string") {
    return (delta as Record<string, unknown>).stop_reason as string;
  }
  return "";
}

/** Log when the model spent the whole budget, including on thinking, and cut the answer off. */
export function warnIfMaxTokensStop(value: unknown, where: string): void {
  if (readStopReason(value) !== "max_tokens") return;
  console.warn(`[learn] ${where} stop_reason=max_tokens; output hit the token budget and may be cut off.`);
}

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
      reasoning_effort: LEARN_THINKING_EFFORT,
      max_tokens: maxTokens,
      temperature,
    } as never,
    gateway ? ({ gateway } as never) : undefined,
  );
  warnIfMaxTokensStop(result, `workers-ai ${meta.stage}`);
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

  const budget = resolveMaxTokens(maxTokens);

  if (!env.AI_GATEWAY_ID && !warnedNoGateway) {
    warnedNoGateway = true;
    console.warn("[learn] AI_GATEWAY_ID is not set; model calls bypass AI Gateway.");
  }

  if (model.startsWith("anthropic/")) {
    // Haiku 5.5's messages schema has no temperature (newer Claude models reject it).
    // Thinking tokens count against max_tokens. Effort defaults to low so a short
    // JSON check cannot spend the whole budget before the answer is written.
    const query: Record<string, unknown> = {
      max_tokens: budget,
      system: `${system}\nReturn ONLY one JSON object. No prose, no code fences.`,
      messages: [{ role: "user", content: user }],
    };
    if (effort) query.output_config = { effort };
    const result = await callAnthropic(env, model, query, attempt > 1 ? { "cf-aig-skip-cache": "true" } : undefined);
    return readAnthropicText(result, meta.stage);
  }

  const gateway = gatewayOptions(env, meta, attempt);
  try {
    return await runWorkers(env, model, system, user, meta, attempt, budget, temperature, gateway);
  } catch (error) {
    if (gateway && isGatewayAuthError(error)) {
      if (!warnedGatewayAuth) {
        warnedGatewayAuth = true;
        console.warn("[learn] AI Gateway rejected the call; retrying on Workers AI directly.");
      }
      try {
        return await runWorkers(env, model, system, user, meta, attempt, budget, temperature, undefined);
      } catch (directError) {
        return chatGptOrThrow(env, userId, system, user, budget, directError);
      }
    }
    return chatGptOrThrow(env, userId, system, user, budget, error);
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
    "cf-aig-request-timeout": String(LEARN_GATEWAY_TIMEOUT_MS),
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
    query: anthropicRequestQuery({ ...query, model: anthropicProviderModel(model) }),
  });
}

async function anthropicPayload(result: unknown): Promise<unknown> {
  if (typeof Response !== "undefined" && result instanceof Response) {
    if (!result.ok) {
      const detail = (await result.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500);
      throw new Error(`Anthropic via gateway: ${result.status}${detail ? ` ${detail}` : ""}`);
    }
    return await result.json().catch(() => null);
  }
  return result;
}

export async function readAnthropicText(result: unknown, where = "anthropic"): Promise<string> {
  const payload = await anthropicPayload(result);
  warnIfMaxTokensStop(payload, where);
  const text = parseWorkersAiText(payload);
  if (!text) throw missingAnthropicText(payload);
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
        call.maxTokens ?? LEARN_MAX_TOKENS,
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

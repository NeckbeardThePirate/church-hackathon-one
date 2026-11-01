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
import { REFINE_MODEL } from "../refine-ocr";

export type LlmRole = "planner" | "worker";

export type LlmEnv = {
  AI: Ai;
  AI_GATEWAY_ID?: string;
  LEARN_MODEL_PLANNER?: string;
  LEARN_MODEL_WORKER?: string;
  ANTHROPIC_API_KEY?: string;
  AI_GATEWAY_TOKEN?: string;
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
};

const MAX_ATTEMPTS = 3;

function modelFor(env: LlmEnv, role: LlmRole): string {
  const configured = role === "planner" ? env.LEARN_MODEL_PLANNER : env.LEARN_MODEL_WORKER;
  return configured?.trim() || REFINE_MODEL;
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

async function complete(
  env: LlmEnv,
  model: string,
  system: string,
  user: string,
  meta: LlmMeta,
  attempt: number,
  maxTokens: number,
  temperature: number,
): Promise<string> {
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
    { gateway: gatewayOptions(env, meta, attempt) } as never,
  );
  return parseWorkersAiText(result);
}

export function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model output.");
  return JSON.parse(trimmed.slice(start, end + 1));
}

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

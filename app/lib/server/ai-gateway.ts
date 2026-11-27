/**
 * Workers AI calls that should show up in AI Gateway.
 * Anthropic messages stay on `env.AI.gateway().run` in `learn/llm.ts`.
 * A gateway auth failure retries once on the binding with no gateway options,
 * the same way the Learn JSON client does.
 */

export type WorkersAiEnv = {
  AI: Ai;
  AI_GATEWAY_ID?: string;
};

/** Third argument to `env.AI.run` when the call should be logged on a gateway. */
export type WorkersGatewayCall = {
  gateway: {
    id: string;
    metadata: Record<string, string | number | boolean | null>;
  };
};

export function workersGatewayCall(
  gatewayId: string | undefined,
  metadata: Record<string, string | number | boolean | null>,
): WorkersGatewayCall | undefined {
  if (!gatewayId) return undefined;
  return { gateway: { id: gatewayId, metadata } };
}

/** Same matcher as the Learn JSON client: gateway auth failures, not model errors. */
export function isGatewayAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /401|403|unauthorized|authentication|cf-aig/i.test(message);
}

const warnedStages = new Set<string>();

export async function runWorkersAi(
  ai: Ai,
  model: string,
  input: unknown,
  call: WorkersGatewayCall | undefined,
): Promise<unknown> {
  const run = (options: WorkersGatewayCall | undefined) =>
    ai.run(model as Parameters<Ai["run"]>[0], input as never, options as never);

  try {
    return await run(call);
  } catch (error) {
    if (!call || !isGatewayAuthError(error)) throw error;
    const stage = String(call.gateway.metadata.stage ?? "workers-ai");
    if (!warnedStages.has(stage)) {
      warnedStages.add(stage);
      console.warn(`[${stage}] AI Gateway rejected the call; retrying on Workers AI directly.`);
    }
    return await run(undefined);
  }
}

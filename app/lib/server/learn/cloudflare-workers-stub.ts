/**
 * Stand-in for cloudflare:workers when route modules are loaded by node:test.
 * The resolve hook maps that specifier onto this module. Tests mutate `env` in place.
 */
export const env: Record<string, unknown> = {};

export class DurableObject {
  ctx: unknown;
  env: unknown;
  constructor(ctx: unknown, envArg: unknown) {
    this.ctx = ctx;
    this.env = envArg;
  }
}

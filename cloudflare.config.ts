import { bindings, defineConfig, defineWorker, exports, triggers } from "cf/config";

const WORKER_NAME = "church-hackathon";

/** Learn pipeline queues (docs/learn-plan.md §6). One per stage + DLQ. */
const LEARN_QUEUES = {
  LEARN_Q_INTAKE: "learn-intake",
  LEARN_Q_SCOPE: "learn-scope",
  LEARN_Q_PLAN: "learn-plan",
  LEARN_Q_RESEARCH: "learn-research",
  LEARN_Q_REVIEW: "learn-review",
  LEARN_Q_TEACH: "learn-teach",
  LEARN_Q_CHECK: "learn-check",
  LEARN_Q_CRITIC: "learn-critic",
  LEARN_Q_ASSEMBLE: "learn-assemble",
} as const;
const LEARN_DLQ = "learn-dlq";
const learnConsumer = (name: string, maxConcurrency: number | null = null) =>
  triggers.queue({ name, deadLetterQueue: LEARN_DLQ, maxBatchSize: 5, maxBatchTimeout: 1, maxRetries: 3, maxConcurrency });

export default defineConfig({
  accountId: "ddd73c1c002a8083f222af44faadeb0f",
  worker: defineWorker({
    name: WORKER_NAME,
    // Wraps vinext's fetch handler and adds queue() + LearnPlanDO.
    entrypoint: "./worker.ts",
    exports: {
      LearnPlanDO: exports.durableObject({ storage: "sqlite" }),
      UserWorkspaceDO: exports.durableObject({ storage: "sqlite" }),
    },
    triggers: [
      learnConsumer(LEARN_QUEUES.LEARN_Q_INTAKE),
      learnConsumer(LEARN_QUEUES.LEARN_Q_SCOPE),
      learnConsumer(LEARN_QUEUES.LEARN_Q_PLAN),
      // Per-lesson stages fan out; cap concurrency to bound Exa + LLM request rate.
      learnConsumer(LEARN_QUEUES.LEARN_Q_RESEARCH, 4),
      learnConsumer(LEARN_QUEUES.LEARN_Q_REVIEW, 4),
      learnConsumer(LEARN_QUEUES.LEARN_Q_TEACH, 4),
      learnConsumer(LEARN_QUEUES.LEARN_Q_CHECK, 4),
      learnConsumer(LEARN_QUEUES.LEARN_Q_CRITIC),
      learnConsumer(LEARN_QUEUES.LEARN_Q_ASSEMBLE),
      triggers.queue({ name: LEARN_DLQ, maxBatchSize: 10, maxBatchTimeout: 5, maxRetries: 1 }),
    ],
    compatibilityDate: "2026-10-30",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      AI: bindings.ai({ dev: { remote: true } }),
      MEDIA: bindings.r2({ name: "church-hackathon-media", dev: { remote: true } }),
      BIBLE: bindings.d1({
        name: "church-hackathon-bible",
        id: "bb9958b5-2734-42bc-8552-10b3b8ab6c6d",
        dev: { remote: true },
      }),
      SCRIPTURE_VECTORS: bindings.vectorize({ name: "church-hackathon-scripture", dev: { remote: true } }),
      LIBRARY_VECTORS: bindings.vectorize({ name: "church-hackathon-library", dev: { remote: true } }),
      CLOUDFLARE_ACCOUNT_ID: bindings.text("ddd73c1c002a8083f222af44faadeb0f"),
      LEARN_PLAN: bindings.durableObject({ worker: WORKER_NAME, exportName: "LearnPlanDO" }),
      USER_WORKSPACE: bindings.durableObject({ worker: WORKER_NAME, exportName: "UserWorkspaceDO" }),
      LEARN_Q_INTAKE: bindings.queue({ name: LEARN_QUEUES.LEARN_Q_INTAKE }),
      LEARN_Q_SCOPE: bindings.queue({ name: LEARN_QUEUES.LEARN_Q_SCOPE }),
      LEARN_Q_PLAN: bindings.queue({ name: LEARN_QUEUES.LEARN_Q_PLAN }),
      LEARN_Q_RESEARCH: bindings.queue({ name: LEARN_QUEUES.LEARN_Q_RESEARCH }),
      LEARN_Q_REVIEW: bindings.queue({ name: LEARN_QUEUES.LEARN_Q_REVIEW }),
      LEARN_Q_TEACH: bindings.queue({ name: LEARN_QUEUES.LEARN_Q_TEACH }),
      LEARN_Q_CHECK: bindings.queue({ name: LEARN_QUEUES.LEARN_Q_CHECK }),
      LEARN_Q_CRITIC: bindings.queue({ name: LEARN_QUEUES.LEARN_Q_CRITIC }),
      LEARN_Q_ASSEMBLE: bindings.queue({ name: LEARN_QUEUES.LEARN_Q_ASSEMBLE }),
      // Learn secrets — must be declared here to reach Worker env from `.dev.vars` / wrangler secrets.
      EXA_API_KEY: bindings.secret(),
      AI_GATEWAY_ID: bindings.secret(),
      AI_GATEWAY_TOKEN: bindings.secret(),
      // Optional model overrides: add `bindings.secret()` if you set LEARN_MODEL_* or ANTHROPIC_API_KEY in .dev.vars.
      CLERK_SECRET_KEY: bindings.text(process.env.CLERK_SECRET_KEY || "CLERK_SECRET_KEY"),
      CLERK_PUBLISHABLE_KEY: bindings.text(
        process.env.CLERK_PUBLISHABLE_KEY ||
          process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
          "CLERK_PUBLISHABLE_KEY",
      ),
    },
  }),
});

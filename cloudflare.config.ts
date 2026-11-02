import { bindings, defineConfig, defineWorker, exports, triggers } from "cf/config";

// Account + D1 IDs live in .env.local (gitignored). See .env.local.example.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the shell environment.
}

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
/** Remote bindings need CLOUDFLARE_API_TOKEN. Without it, `vite dev` uses local simulations. */
const useRemote = Boolean(process.env.CLOUDFLARE_API_TOKEN);
const devBinding = { remote: useRemote };
const learnConsumer = (name: string, maxConcurrency: number | null = null) =>
  triggers.queue({ name, deadLetterQueue: LEARN_DLQ, maxBatchSize: 5, maxBatchTimeout: 1, maxRetries: 3, maxConcurrency });

export default defineConfig({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
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
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: { enabled: true, invocationLogs: true, persist: true },
      traces: { enabled: true, persist: true },
    },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      // Workers AI cannot run locally. `remote: false` is rejected by the Vite plugin.
      // Without a token, vite.config.ts disables remote bindings and MOCK_AI answers plans.
      AI: useRemote ? bindings.ai({ dev: { remote: true } }) : bindings.ai(),
      MEDIA: bindings.r2({ name: "church-hackathon-media", dev: devBinding }),
      BIBLE: bindings.d1({
        name: "church-hackathon-bible",
        id: process.env.BIBLE_D1_DATABASE_ID,
        dev: devBinding,
      }),
      SCRIPTURE_VECTORS: bindings.vectorize({ name: "church-hackathon-scripture", dev: devBinding }),
      LIBRARY_VECTORS: bindings.vectorize({ name: "church-hackathon-library", dev: devBinding }),
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
      AI_GATEWAY_ID: bindings.text("study-buddy"),
      // Empty means the Workers AI default (@cf/zai-org/glm-5.3-flash). Set a model id to override.
      LEARN_MODEL_PLANNER: bindings.text(""),
      LEARN_MODEL_WORKER: bindings.text(""),
      AI_GATEWAY_TOKEN: bindings.secret(),
      SESSION_SECRET: bindings.secret(),
      OPENAI_CLIENT_ID: bindings.secret(),
      OPENAI_CLIENT_SECRET: bindings.secret(),
      LEARN_CHATGPT_MODEL: bindings.secret(),
      ADMIN_TOKEN: bindings.secret(),
      BRAVE_SEARCH_API_KEY: bindings.secret(),
      CLERK_SECRET_KEY: bindings.secret(),
      CLERK_PUBLISHABLE_KEY: bindings.secret(),
      // Baked at process start. Production deploys must leave these unset so both stay "".
      DEV_AUTH: bindings.text(process.env.DEV_AUTH === "1" ? "1" : ""),
      MOCK_AI: bindings.text(process.env.MOCK_AI === "1" ? "1" : ""),
    },
  }),
});

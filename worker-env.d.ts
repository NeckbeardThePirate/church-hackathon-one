export {};

declare module "cloudflare:workers" {
  interface Env {
    CLERK_SECRET_KEY?: string;
    CLERK_PUBLISHABLE_KEY?: string;
    ADMIN_TOKEN?: string;
    BRAVE_SEARCH_API_KEY?: string;
    /** Learn: direct Exa search + /contents (see app/lib/server/learn/exa.ts). */
    EXA_API_KEY?: string;
  }
}

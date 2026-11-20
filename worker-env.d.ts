export {};

declare module "cloudflare:workers" {
  interface Env {
    CLERK_SECRET_KEY?: string;
    CLERK_PUBLISHABLE_KEY?: string;
    ADMIN_TOKEN?: string;
    BRAVE_SEARCH_API_KEY?: string;
    /**
     * Optional. Exa calls use AI Gateway (`custom-exa`) and send this only when set.
     * No Brave code path reads BRAVE_SEARCH_API_KEY; an unset key means Brave is not called.
     */
    EXA_API_KEY?: string;
    OPENAI_CLIENT_ID?: string;
    OPENAI_CLIENT_SECRET?: string;
  }
}

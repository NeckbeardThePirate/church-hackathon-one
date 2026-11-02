# StudyBuddy

StudyBuddy turns a topic or your notes into an ongoing study plan cited to Scripture (Berean Study Bible), the Reformed confessions, and the church fathers, then walks you through the lessons and quiz.

It is a [vinext](https://github.com/cloudflare/vinext) app deployed as one Cloudflare Worker named `church-hackathon`. Bindings and queues live in `cloudflare.config.ts`. That file is the deploy source of truth. `wrangler.jsonc` only names the Worker so older tooling can find the account.

## Scripts

- `npm run dev` starts the local Worker (Vite). Set `CLOUDFLARE_API_TOKEN` to use the remote D1, R2, Vectorize, and Workers AI bindings. Without a token, those bindings are local simulations and Workers AI is not called.
- `DEV_AUTH=1 MOCK_AI=1 npm run dev` adds a loopback-only sign-in and a deterministic plan generator so the app runs with no Cloudflare login. Do not set either variable for a production build. `npm run build` bakes their values into the Worker.
- `npm run typecheck` regenerates Worker types and runs `tsc`.
- `npm run test` runs the unit tests.
- `npm run build` writes the Worker bundle.
- `npm run deploy` deploys with the Cloudflare CLI (`vinext-cloudflare deploy`). Do not deploy from the stub `wrangler.jsonc`.

## Auth

Sign in with ChatGPT (OpenID Connect + PKCE) is the path that does not need another vendor. On a public host it needs `OPENAI_CLIENT_ID` from an OpenAI OAuth client you register. On `http://127.0.0.1` the open-source dynamic client can register without a secret.

Clerk sign-in is offered alongside ChatGPT when `CLERK_SECRET_KEY` is set. The publishable key comes from `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_PUBLISHABLE_KEY` if set, otherwise the Worker derives it from the secret key and serves it at `/api/auth/providers`.

`DEV_AUTH=1` enables a loopback-only “Continue on this computer” button. It is refused on every other host. Leave it unset in production.

Study plans call Workers AI (through the `study-buddy` AI Gateway when that gateway accepts the call). A stored ChatGPT plan token is used only if Workers AI fails and `LEARN_CHATGPT_MODEL` is set.

Copy `.dev.vars.example` to `.dev.vars` and `.env.local.example` to `.env.local`. Never commit those files.

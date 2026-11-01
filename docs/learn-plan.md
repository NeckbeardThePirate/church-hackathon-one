# Learn Pipeline — Implementation Plan

Status: draft · Scope: the `learn` project kind · No code changes in this doc.

## 1. Goal

A user gives the Learn project a topic as **text**, **images**, or both. An agentic pipeline returns a multi-lesson plan:

- Lessons sized to topic complexity (more for complex, fewer for simple).
- Per lesson: teaching notes, videos, articles, books, scripture readings, a quiz.
- Course level: book list, final assessment, prerequisite map.
- Reviews on every resource, with the basis for each review stated.

Output lands in the existing editor as normal blocks, plus a structured `learnPlan` on the project.

**Non-goals (v1)**
- Live web browsing by the model. Tools fetch; the model only selects and writes.
- Multi-user sharing, accounts, or course completion tracking.
- Generating video or audio content.

## 2. Current state (what we reuse)

| Need | Already exists | Where |
|---|---|---|
| Image upload → R2 | `POST /api/projects/[projectId]/source-image` | `app/api/projects/[projectId]/source-image/route.ts` |
| OCR (vision) | `runImageOcr` on `@cf/meta/llama-3.2-11b-vision-instruct` | `app/lib/server/ocr.ts` |
| Structure OCR text | `REFINE_MODEL` (`@cf/zai-org/glm-5.3-flash`) JSON mode | `app/lib/server/refine-ocr.ts` |
| Retrieval-grounded AI | "Go deeper": model picks from retrieved candidate IDs; text comes from D1 | `app/lib/server/go-deeper.ts` |
| Scripture lookup | Hybrid semantic + FTS over BSB; passage fetch by reference | `app/lib/server/scripture-search.ts`, `bible-db.ts`, `app/lib/bible/parse-reference.ts` |
| Fathers / confessions | Library search with `condemned` flag | `app/lib/server/library-search.ts` |
| Rich block pattern | `bible-callout` block kind + component | `app/components/BibleCalloutBlock.tsx`, `app/lib/projects.ts` |
| Bindings | `AI`, `BIBLE` (D1), `SCRIPTURE_VECTORS`, `LIBRARY_VECTORS`, `MEDIA` (R2) | `wrangler.jsonc`, `cloudflare.config.ts` |

**Gaps**
- No external search (web, video, books). Nothing in the repo fetches arbitrary URLs.
- No durable multi-step job runner. Current AI calls are single request/response.
- Projects are localStorage-only. No server-side store for generated plans.
- Public API routes (`/api/study/deeper`, `/api/notes/auto-format`, `/api/projects/*`) have **no auth or rate limiting**. A pipeline that spends paid search quota must not ship like that.

## 3. Pipeline overview

```
 Intake ──► Scope ──► Plan ──► [ per-lesson fan-out, concurrency ≤ 3 ]
 (text +     (complexity,       ┌─────────────────────────────────────────┐
  images)     prereqs,          │ Research ─► Verify ─► Select & Review   │
              lesson band)      │   ─► Teach ─► Quiz ─► Lesson Check      │
                                └─────────────────────────────────────────┘
                                         │
                       Course Critic ◄───┘  (repair loop, max 2 passes)
                              │
                          Assemble ──► Persist (project.learnPlan + blocks)
```

Each stage is a queue consumer (see §6). Every stage transition emits a progress event to the plan's DO. Stages that call an LLM validate output against a schema. A failed validation retries twice, then marks that step degraded and continues.

### Stage details

**S0 Intake**
- Text: topic and optional notes, normalized (`text-blocks.ts` helpers).
- Images (≤5 per plan for v1): reuse OCR + refine for text-bearing images (syllabi, book covers, notes, whiteboards). For non-text images (diagrams, objects), run a vision "describe for learning" prompt on the same vision model.
- Output: `TopicBrief { topic, notes, sourceText, imageDescriptions[], perspective ("neutral" | Tradition), includeScripture: "auto" | "yes" | "no" }`.

**S1 Scope (agent)**
- Decides complexity and lesson count. Output: `complexity`, `prerequisites[]`, `coreConcepts[]`, `isFaithRelevant` (drives scripture and library tools).
- Lesson band (hard limits, enforced in code):

| Complexity | Lessons | Signals | Per-lesson time | Quiz items per lesson | Final assessment |
|---|---|---|---|---|---|
| Simple | 1–2 | single concept or one skill; < ~1 hr total | 15–30 min | 3–4 | none |
| Moderate | 3–5 | several linked concepts; a few prerequisites | 25–45 min | 4–6 | 6 items |
| Complex | 6–10 | broad field; deep prerequisite chain; multi-stage | 30–60 min | 5–8 | 10 items |

- The model proposes a number; code clamps it to the band for the chosen complexity.

**S2 Plan (agent)**
- Ordered lessons: `{ order, title, objectives[], prerequisiteLessonIds[], estimatedMinutes, searchHints[] }`.
- `searchHints` are queries for the research agents. They are not URLs.
- Checks in code: lesson count in band, no orphan prerequisites, no cycles, objectives non-empty.

**S3 Research (agent, per lesson)**
- Bounded tool loop: max 8 tool calls, max 3 search queries per tool type.
- Tools (§5). The agent picks which to call based on the lesson and `isFaithRelevant`. Example: a chemistry lesson gets no scripture calls; a theology lesson gets scripture and library calls.
- Output: candidate lists only. No prose yet.

**S4 Verify (code, no LLM)**
- Every URL: fetch, require 2xx, reject obvious soft-404 (empty body, "not found" title), record final URL.
- YouTube: confirm via oEmbed or `videos.list`; record title, channel, duration.
- Books: require ISBN or Open Library / Google Books ID; take title and author from the record, never from the model.
- Scripture: `findBibleReferences` must parse it; text comes only from `fetchPassageFromD1`.
- Anything that fails is dropped. Drops are logged on the lesson as `warnings`.

**S5 Select & Review (agent)**
- Chooses from verified candidates only. Model cannot add a resource.
- Writes a review for each resource, grounded in the source text available:
  - Article: review from fetched, extracted text.
  - Video: review from title, channel, description, and duration only. YouTube caption download needs OAuth, so we don't get transcripts. Review is labeled `basis: "metadata"`.
  - Book: rating and count from Google Books / Open Library (cited as data, not generated). Model writes a "who it's for / what it covers / caveats" note from the description.
  - Scripture and fathers/confessions: model writes a one-line "why this connects" note. Text stays verbatim.
- Rule: **never generate star ratings or view counts.** Those fields come from the API response or are omitted.

**S6 Teach (agent)**
- Inputs: lesson objectives, selected resources (titles and reviews), verified scripture text.
- Output: 3–8 blocks (explain, key ideas, worked example, discussion questions). Uses existing block types.
- For faith-relevant topics with disputed doctrine:
  - **Neutral:** present each main position in its own block, attributed. Take no side.
  - **Tradition:** teach from that tradition's standards, attributed ("The Reformed tradition holds…, because…"). Other positions appear in a labeled section. Never state a tradition's view as settled fact for everyone.

**S7 Quiz (agent)**
- Items per §3 S1 table. Mix of multiple choice and short answer.
- Each item: `question`, `answer`, `rationale`, `objectiveId`, `sourceRef` (lesson section or scripture reference).
- Scripture items: the quoted text is inserted from D1, not written by the model.

**S8 Lesson Check (agent, separate prompt from S7)**
- Answers each quiz item from the lesson text only. Flags items it cannot answer or answers differently than the key.
- Failed items are regenerated once. If still failing, dropped and the lesson is marked `degraded`.

**S9 Course Critic (agent)**
- Checks: objective coverage, duplicate resources across lessons, prerequisite order, total time vs. band, tone and perspective consistency.
- Returns `{ ok, issues[] }`. Issues route back to the specific lesson step. Max 2 repair passes, then ship with warnings.

**S10 Assemble & Persist**
- Builds `LearnPlan` JSON (§7) and the block list for the editor.
- Writes to the project (§7.3).

## 4. Model roles

| Role | Stages | Recommended model | Notes |
|---|---|---|---|
| Vision / OCR | S0 | `@cf/meta/llama-3.2-11b-vision-instruct` | Already in use. |
| Structuring | S0 | `@cf/zai-org/glm-5.3-flash` | Already in use. |
| Planning / critic | S1, S2, S9 | **Decision D2** | Strongest reasoning here. |
| Research / select / review | S3, S5 | Workers AI mid-tier, or same as planner | Keep tool loops short. |
| Teach / quiz / check | S6, S7, S8 | Workers AI mid-tier | Quiz check must be a separate call from generation. |

**All model calls go through Cloudflare AI Gateway.** Workers AI and any Anthropic model alike. One `llm.ts` client in `app/lib/server/learn/` is the only place a model is called. The gateway gives per-stage logs, cost and latency, caching for deterministic stages, and provider fallback.

- Gateway config (ID, provider keys) lives in the gateway, not the repo. Code references the gateway by ID from env.
- Match the binding or REST shape to the gateway code already in progress. This doc does not assume it.
- Stages tag each request with `planId`, `stage`, `lessonId` metadata so cost reports roll up per plan.

All LLM calls use JSON mode with a schema. Responses that fail validation are retried or degraded (§3).

## 5. Tool registry

| Tool | Backed by | Returns | Notes |
|---|---|---|---|
| `search_videos(q)` | YouTube Data API v3 `search.list` + `videos.list` | id, title, channel, duration, description | **Quota: `search.list` costs 100 units; default daily quota is 10,000.** Cache aggressively (§9). |
| `search_articles(q)` | **Exa** `/search` | url, title, author, publishedDate, snippet | Neural search. Results go to `verify` (Exa contents status). |
| `fetch_page(url)` | **Exa** `/contents` | per-URL status, title, author, text (markdown, capped) | Use Exa's per-URL `statuses` as the liveness gate. HTTP 200 alone does not mean the URL succeeded. Error tags (e.g. not found, timeout) map to drops. |
| `find_books(q)` | Open Library search + Google Books | title, authors, isbn, description, averageRating, ratingsCount, publishedYear | Both free. Google Books key optional. |
| `lookup_scripture(q)` | `searchScripture` (hybrid) + `findBibleReferences` + `fetchPassageFromD1` | reference, verse text | Existing code. |
| `search_library(q)` | `searchFathers` / `searchConfessions` | id, author/doc, passage, text, condemned | Only when `isFaithRelevant`. Existing code. |
| `check_url(url)` | Exa `/contents` status | status, error tag | Dropped as a separate tool. Liveness comes from `fetch_page`. |

Tool outputs are the only source of URLs, ISBNs, titles, ratings, and verse text. The model may quote or summarize them. It may not invent them.

## 6. Orchestration

**Choice:** Cloudflare Queues carry every stage. One Durable Object per plan is the coordinator and progress hub. Workflows is dropped as the primary orchestrator.

Why: each stage transition is a visible message, so progress is visible as it happens. Per-lesson fan-out is one message per lesson. The coordinator DO serializes state changes, so "all lessons done" is counted correctly even with parallel consumers.

**Queues (one per stage, all in one Worker):**

| Queue | Producer | Consumer work | Fan-out |
|---|---|---|---|
| `learn-intake` | API `POST` | S0 intake | 1 |
| `learn-scope` | intake | S1 scope | 1 |
| `learn-plan` | scope | S2 plan | 1 |
| `learn-research` | plan | S3 research (tool loop) | 1 per lesson |
| `learn-verify` | research | S4 verify (code) | 1 per lesson |
| `learn-review` | verify | S5 select & review | 1 per lesson |
| `learn-teach` | review | S6 teach + S7 quiz | 1 per lesson |
| `learn-check` | teach | S8 lesson check | 1 per lesson |
| `learn-critic` | coordinator (all lessons done) | S9 course critic | 1 |
| `learn-assemble` | critic | S10 assemble + persist | 1 |
| `learn-dlq` | any queue after max retries | — | — |

- Messages carry IDs only (`planId`, `lessonId`, `stage`, `attempt`, `idempotencyKey`). Payloads live in the plan's DO storage or D1. Keep messages small.
- **Delivery is at-least-once.** Every consumer checks the DO for the stage's current state and skips duplicates. Idempotency key = `planId:stage:lessonId:attempt`.
- Retry: default `max_retries` on each queue, then `learn-dlq`. A DLQ message marks the lesson `degraded` in the DO. It does not kill the plan.
- Concurrency: `max_concurrency` on research, verify, review, teach. Caps Exa and LLM request rates per plan.

**Coordinator Durable Object (`LearnPlanDO`, one per `planId`):**
- Owns the plan state machine and counters: lessons pending, lessons done, degraded, budgets used.
- Enforces budgets before enqueuing more work (§9). On breach, it stops enqueuing and assembles a `partial` plan.
- Holds the progress stream. Clients subscribe via SSE from the DO (§8). Every stage transition pushes an event.

**Progress events (what the user sees):**

```
planned   → 6 lessons: Foundations · Scripture basis · …
research  → L2 Scripture basis: 3 videos, 4 articles, 1 book found
verify    → L2: 2 links dropped (404), 1 scripture ref unresolved
review    → L2: 4 resources reviewed (basis: text ×3, metadata ×1)
teach     → L2: 5 blocks, 6 quiz items
check     → L2: 5/6 quiz items confirmed · 1 regenerated
critic    → 1 repair: L4 duplicates L1 video
done      → 6/6 lessons · 0 degraded · 3 warnings
```

**Budgets per plan** (enforced by the DO, not the prompt):
- LLM calls ≤ 120 (all through AI Gateway, §4)
- Exa calls ≤ 12 per lesson (search + contents combined), ≤ 120 per plan. Raised from 40 to fit across-the-board sourcing (D6). Revisit after M1 measurements.
- Wall-clock ≤ 10 min for complex plans; on overrun, assemble a `partial` plan

**Fallback:** if Queues cannot carry the per-stage consumers cleanly in this Worker (§12 spike), fall back to one queue with a `stage` field and a single dispatcher. Same DO coordinator.

## 7. Data model

### 7.1 Types

```ts
type LearnPlan = {
  id: string;
  topic: string;
  complexity: "simple" | "moderate" | "complex";
  status: "running" | "complete" | "partial" | "failed";
  prerequisites: string[];
  objectives: string[];
  lessons: LearnLesson[];
  courseBooks: BookResource[];
  finalAssessment?: QuizItem[];
  perspective: "neutral" | Tradition;   // Tradition = one of the D5 list; set per plan, defaults from workspace setting
  // every resource and quiz item also carries a perspective tag
  warnings: string[];
  createdAt: number;
};

type LearnLesson = {
  id: string;
  order: number;
  title: string;
  objectives: string[];
  prerequisiteLessonIds: string[];
  estimatedMinutes: number;
  status: "ok" | "degraded";
  teaching: BlockContent[];      // editor blocks
  videos: VideoResource[];
  articles: ArticleResource[];
  books: BookResource[];
  scripture: ScriptureReading[];
  library: LibraryResource[];    // fathers / confessions, faith topics only
  quiz: QuizItem[];
  warnings: string[];
};

type ResourceBase = { url: string; reviewed: boolean; review: string; reviewBasis: "text" | "metadata" | "api" };
type VideoResource = ResourceBase & { title: string; channel: string; durationSec?: number; videoId: string };
type ArticleResource = ResourceBase & { title: string; siteName?: string };
type BookResource = ResourceBase & { title: string; authors: string[]; isbn?: string; averageRating?: number; ratingsCount?: number; year?: number };
type ScriptureReading = { reference: string; text: string; note: string };   // text from D1 only
type LibraryResource = { id: string; source: "father" | "confession"; label: string; text: string; note: string; condemned?: boolean };
type QuizItem = { kind: "mc" | "short"; question: string; choices?: string[]; answer: string; rationale: string; objectiveId: string; sourceRef?: string };
```

`averageRating` and `ratingsCount` are optional and set only from API data. The UI shows nothing when they are absent.

### 7.2 Editor blocks

Extend `BlockContent.kind` (`app/lib/projects.ts`) with `"resource"` and `"quiz"`, following the `bible-callout` pattern:
- `ResourceCardBlock` (video / article / book): title, source, review, link, verified badge.
- `QuizBlock`: collapsible items with reveal for answer and rationale.
- Scripture reads reuse `bible-callout`.

Editing and deletion work the same as other blocks. Regenerate-one-lesson is an M4 item.

### 7.3 Persistence

- **v1 (M1–M3):** store `learnPlan` on the project in localStorage, same as other project data. Plans with ~30 resources are well under the localStorage quota per project.
- **Later (if multi-device is needed):** D1 table `learn_plans(id, project_id, json, status, created_at)`. Migration `migrations/0004_learn.sql`.
- Images stay in R2 under `projects/<projectId>/…`, as now.

## 8. API surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/learn/plans` | Body: `{ projectId, topic, notes?, imageKeys?[], options }`. Enqueues `learn-intake`. Returns `202 { planId }`. |
| `GET` | `/api/learn/plans/:planId` | Returns `{ status, stage, lessonsDone, lessonsTotal, warnings, plan? }`. `plan` is present when `complete` or `partial`. |
| `GET` | `/api/learn/plans/:planId/events` | SSE stream from `LearnPlanDO`. Sends each progress event (§6) as it happens. Reconnects resume from last event id. |
| `POST` | `/api/learn/plans/:planId/lessons/:lessonId/regenerate` | M4. Enqueues S3–S8 for one lesson. |

Auth: required before deploy (§9). Plans are keyed by `planId` (UUID), validated the same way as `assertProjectId`.

## 9. Guardrails and security

**Blockers before any public deploy**
- Auth on `/api/learn/*`. Options: Cloudflare Access on the route, or a session token from the app. The existing routes are unauthenticated; do not copy that pattern.
- Rate limiting per IP and per user, using a Cloudflare rate-limit binding or a counter in a Durable Object.
- Per-plan budget (§6). Hard stop on breach.

**Content guardrails**
- No URL, ISBN, title, rating, view count, or verse text from the model. All from tools (§5).
- Scripture: the reference must parse and resolve in D1. A reference that does not resolve is dropped.
- Faith topics with disputed doctrine: show the disagreement and perspective tags. Default is neutral unless the workspace or plan sets a tradition (D5).
- Tradition mode uses that tradition's confessions and catechisms from the library as anchors. The library `condemned` flag still applies.
- Church fathers flagged `condemned` (from `library-search`) are labeled in the UI, not hidden.
- Reviews of videos and books are labeled with their basis (`text`, `metadata`, `api`).

**Secrets**
- New: `EXA_API_KEY`, `YOUTUBE_API_KEY`, optional `GOOGLE_BOOKS_API_KEY`, AI Gateway ID (and token if the gateway requires one).
- Set via `wrangler secret put` in production. Add placeholders to `.dev.vars.example`. Never commit values.
- **Exa (M3, current):** `EXA_API_KEY` only. Search and `/contents` call `api.exa.ai` directly (`app/lib/server/learn/exa.ts`). AI Gateway covers Learn **model** calls only.
- **Exa (later):** Web Search API through the same gateway (`provider: exa`, optional BYOK) for observability/unified billing on search; keep direct `/contents` for verify until CF exposes domain filters and Exa-style per-URL statuses.

**Cost controls**
- YouTube quota: cache `search.list` results per query for 7 days (KV or D1). Expect a few hundred plan-starts per day at most on the default quota; request a quota increase if usage grows.
- Cache Exa `/contents` results by URL for 24 hours.

## 10. Evaluation

**Golden set (12 topics):**
- Simple (4): e.g., "tie a bowline", "what is a percentage", "Psalm 23 for beginners", "how to read a Greek verb table".
- Moderate (4): e.g., "compound interest", "intro to Git", "the Trinity", "justification by faith".
- Complex (4): e.g., "linear algebra for ML", "covenant theology across Scripture", "the Reformation's major disputes", "personal financial planning".

Adjust the list with the user. Include at least two faith topics and two non-faith topics in each band.

**Metrics (automated, run in `scripts/learn-eval.mts`):**

| Metric | Target |
|---|---|
| Lesson count in band | 100% |
| Shipped URLs that returned 2xx at verify time | 100% |
| Scripture references resolved in D1 | 100% |
| Quiz items answered correctly by Lesson Check | ≥ 95% (after one regen) |
| Plan wall-clock p50 / p95 | record; target p95 ≤ 10 min complex |
| Cost per plan (LLM + search units) | record; set ceiling after M1 |

**Human review:** two reviewers rate 20 sampled lessons on accuracy, usefulness of resources, and quiz quality, 1–5 each.

## 11. Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 Spikes** | (a) Queue consumers in the vinext Worker: `queue()` export through the `virtual:vinext-worker-entry` path, local dev and deploy. (b) `LearnPlanDO` + SSE through vinext. (c) Planner JSON reliability on 12 topics through AI Gateway. (d) Exa `/contents` status behavior on 20 known-good and known-dead URLs. (e) YouTube quota check. | Each spike has a written pass/fail. If (a) fails, use the single-dispatcher fallback (§6). |
| **M1 Core plan (text only)** | Intake (text) → Scope → Plan → Teach → Quiz → Lesson Check → Assemble, all on queues with the progress stream. All model calls through AI Gateway. No external resources. | 12 golden topics produce valid plans in band. Quiz check passes ≥ 90%. Progress events render in the UI in order. |
| **M2 Scripture & books** | `lookup_scripture`, `search_library` (faith topics), `find_books`, verify gates for both. Perspective setting (neutral / tradition), workspace default, per-plan override, and perspective tags on every resource. | 100% scripture refs resolve. Book records have ISBN or catalog ID. |
| **M3 Articles & videos + review** | `search_videos` (YouTube Data API), `search_articles` and `fetch_page` (Exa), verify gates, Select & Review. | 0 unverified links shipped. Review basis labeled on every resource. |
| **M4 Images & UX** | Image intake (OCR/refine + vision describe). Progress UI. Resume after reload. Regenerate one lesson. | Image-only and text+image topics produce plans. |
| **M5 Hardening** | Auth, rate limits, budgets, eval script in CI, logs for each stage. | Auth and rate limit verified with tests. Budget breach yields a partial plan, not a 500. |

M1 and M2 can overlap with M0 results. M3 depends on the video discovery decision (D8). Exa (D1) is settled.

### Status (2026-10-31)

- **M0(a) passed.** Custom entry `worker.ts` wraps vinext's fetch handler and adds `queue()` + `LearnPlanDO`. `vite build` emits both exports and all 8 queue consumers. Queues and the DO work in local dev.
- **M0(b) passed.** SSE from the DO streams through the vinext route.
- **M1 done** (text only). Intake → scope → plan → teach+quiz → check → critic (repair loop) → assemble, with live progress in the UI. Scripture readings (M2 item) are included: refs verified in D1, text never model-generated. Perspective modes (neutral / tradition) work.
- **Test runs (local dev, Workers AI glm, no gateway):** "How to pray the Psalms" (moderate, 4 lessons, 2 repair rounds, 266 s); "How to tie a bowline knot" (simple, 2 lessons, no scripture, 109 s); "Infant baptism", Reformed (moderate, 4 lessons, 271 s). All quiz items confirmed by Lesson Check after regen.
- **M3 built, untested against Exa** (no key available at build time). New per-lesson queues `learn-research` (Exa search for articles + YouTube-domain search for videos; verify via Exa `/contents` statuses and YouTube oEmbed) and `learn-review` (model selects from verified candidates by id; reviews grounded in fetched text; videos labeled "reviewed from description"). Videos use oEmbed instead of the YouTube Data API: no key, no quota (D8). All 10 queues created in the Cloudflare account. Without `EXA_API_KEY`, research is skipped and the plan still builds.
- **Not done:** M0(c) planner reliability on all 12 golden topics; M0(d)/(e) Exa and YouTube spikes; M2 books + library; M3 Exa articles/videos + reviews; M4 images; M5 rate limits + eval script. Queue names, idempotency, and budgets are in place for the remaining stages.

## 12. Files likely touched

New:
- `app/lib/server/learn/` — `llm.ts` (AI Gateway client, only model entry point), `exa.ts` (search + contents), `youtube.ts`, `queues/*.ts` (one consumer per stage), `stages/*.ts` (scope, plan, research, verify, select-review, teach, quiz, lesson-check, critic, assemble), `tools/*.ts`, `schemas.ts`, `budget.ts`
- `app/lib/server/learn/plan-do.ts` — `LearnPlanDO` coordinator and SSE hub
- `app/api/learn/plans/[planId]/events/route.ts` — SSE proxy to the DO
- `app/api/learn/plans/route.ts`, `app/api/learn/plans/[planId]/route.ts`
- `app/components/LearnIntakeStep.tsx`, `app/components/LearnPlanProgress.tsx`, `app/components/ResourceCardBlock.tsx`, `app/components/QuizBlock.tsx`
- `migrations/0004_learn.sql` (cache tables; `learn_plans` if D1 persistence is chosen)
- `scripts/learn-eval.mts`

Changed:
- `app/lib/projects.ts` — `learnPlan` on `Project`; new `BlockContent.kind` values
- `app/components/WorkspaceApp.tsx` — `learn` kind routes to intake instead of plain editor
- `app/components/ProjectPicker.tsx` / `ProjectKind` copy — update Learn description
- `app/components/EditorBlock.tsx`, `RichBlockEditor.tsx` — render new block kinds
- `wrangler.jsonc`, `cloudflare.config.ts` — Queue producers and consumers (one per stage, plus DLQ), `LearnPlanDO` binding, KV for search cache, AI Gateway ID
- `.dev.vars.example` — new secret placeholders

## 13. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| D1 | Web search and fetch provider | **Resolved: Exa** for search and page content. |
| D2 | Planner / critic model | All calls go through AI Gateway (resolved). Still open: Claude (`claude-sonnet-5-5` or `claude-opus-5-5`) for S1, S2, S9 vs. `glm-5.3-flash`. Depends on whether the gateway holds an Anthropic key. Keep Workers AI for vision, OCR, and cheap steps. |
| D8 | Video discovery | YouTube Data API for search and metadata (quota: `search.list` = 100 units). Exa as an alternative if its domain filter returns usable video results. Spike in M0(e). |
| D3 | Persistence | localStorage for M1–M3. Move to D1 only if multi-device use is needed. |
| D4 | Access control before deploy | Cloudflare Access on `/api/learn/*` for staff use; app-session auth if it goes to clients. |
| D5 | Faith-topic perspective default | **Changed:** two modes, set per workspace with a per-plan override. **Neutral** (default): present the main positions, tag each resource by perspective, take no side. **Tradition**: pick one denomination; teaching and resource ordering follow that tradition's standards, with other positions still shown and labeled. Starting tradition list (confirm): Reformed, Lutheran, Anglican, Catholic, Orthodox, Baptist, Methodist, Pentecostal/charismatic. Selection labels and orders; it does not exclude resources (proposed, confirm). |
| D6 | Scope of "learn" | **Resolved:** general-purpose topics. Resources pulled from across the board by default (all source types, all perspectives). Scripture and library tools switched on by topic. |
| D7 | Lesson band | **Resolved:** bands in §3 S1 approved. |

## 14. Risks

- **Link rot and paywalls.** Verify gates drop some good sources. Mitigation: prefer open sources in search; log drops so the band can be tuned.
- **Video reviews are metadata-only.** Caption download needs OAuth. Mitigation: label as `metadata`; weight the review language accordingly.
- **Quota exhaustion (YouTube).** Mitigation: caching, per-plan budgets, quota alerting.
- **Exa cost per plan.** Search plus contents calls per lesson add up. Mitigation: `text` capped per page; cache by URL for 24 hours; per-plan Exa budget (§6).
- **Queue message limits.** Size and batch limits are not confirmed against Cloudflare's limits page (the search results conflicted). Mitigation: IDs-only messages (§6); check limits in M0(a).
- **At-least-once delivery.** Duplicate messages can double-spend Exa and LLM budget. Mitigation: idempotency keys and DO state checks before each paid call.
- **Gateway dependency.** Every model call routes through AI Gateway. An outage stops all plans. Mitigation: gateway fallback config; plans resume from the last queue message after recovery.
- **Small-model quiz errors.** Mitigation: separate Lesson Check call (S8); drop failing items; mark degraded.
- **Doctrinal sensitivity.** Mitigation: perspective tags, disagreement shown, reviewer sign-off on faith-topic golden set.
- **Cost per plan unknown until M1.** Mitigation: budgets set after M1 measurements.

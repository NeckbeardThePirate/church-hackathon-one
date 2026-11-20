/**
 * Exa client (search + contents) and verification helpers. docs/learn-plan.md §5.
 * The model never supplies URLs: every resource URL comes from an Exa result,
 * and survives only if Exa /contents reports it reachable (or YouTube oEmbed confirms it).
 *
 * Calls go through the AI Gateway custom provider `exa` (request path `custom-exa/…`).
 * The gateway's base URL must be `https://api.exa.ai`, so `/search` and `/contents`
 * stay the Exa API. Authenticate with `AI_GATEWAY_TOKEN` (`cf-aig-authorization`).
 * `EXA_API_KEY` is optional: it is sent as `x-api-key` only when set. When it is
 * unset, the gateway uses the Exa key Judah stores on the gateway.
 * https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/
 *
 * Without a gateway token, a set `EXA_API_KEY` still calls api.exa.ai directly so
 * local dev keeps working. With neither, callers skip Exa.
 */
const EXA_BASE = "https://api.exa.ai";
/** Provider segment on the gateway URL. Custom provider slug `exa`. */
export const EXA_GATEWAY_PROVIDER = "custom-exa";
const TIMEOUT_MS = 20_000;

export type ExaGateway = {
  gateway(id: string): { getUrl(provider?: string): Promise<string> };
};

export type ExaAuth = {
  apiKey?: string;
  gatewayId?: string;
  gatewayToken?: string;
  ai?: ExaGateway;
};

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function exaReady(auth: ExaAuth): boolean {
  return Boolean((configured(auth.gatewayId) && configured(auth.gatewayToken) && auth.ai) || configured(auth.apiKey));
}

/** Headers for one Exa call. Omits `x-api-key` when no Exa key is configured. */
export function exaHeaders(apiKey: string | undefined, gatewayToken: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = configured(apiKey);
  const token = configured(gatewayToken);
  if (key) headers["x-api-key"] = key;
  if (token) headers["cf-aig-authorization"] = `Bearer ${token}`;
  return headers;
}

export function exaEndpoint(path: string, gatewayBase: string | undefined): string {
  if (gatewayBase) return `${gatewayBase.replace(/\/$/, "")}${path}`;
  return `${EXA_BASE}${path}`;
}

export function exaAuthFrom(env: {
  EXA_API_KEY?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  AI?: ExaGateway;
}): ExaAuth {
  return {
    apiKey: env.EXA_API_KEY,
    gatewayId: env.AI_GATEWAY_ID,
    gatewayToken: env.AI_GATEWAY_TOKEN,
    ai: env.AI,
  };
}

export type ExaResult = {
  id: string;
  url: string;
  title: string;
  author?: string;
  publishedDate?: string;
  text?: string;
  highlights?: string[];
};

type ExaStatus = { id: string; status: "success" | "error"; error?: { tag?: string; httpStatusCode?: number | null } | null };

async function gatewayBase(auth: ExaAuth): Promise<string | undefined> {
  const gatewayId = configured(auth.gatewayId);
  const token = configured(auth.gatewayToken);
  if (!gatewayId || !token || !auth.ai) return undefined;
  const base = await auth.ai.gateway(gatewayId).getUrl(EXA_GATEWAY_PROVIDER);
  if (!base) throw new Error("AI Gateway did not return an Exa URL. The custom provider slug must be exa.");
  return base;
}

async function exaPost<T>(auth: ExaAuth, path: string, body: unknown): Promise<T> {
  const base = await gatewayBase(auth);
  const apiKey = configured(auth.apiKey);
  if (!base && !apiKey) {
    throw new Error("Exa is not configured. AI Gateway auth is missing and EXA_API_KEY is unset.");
  }
  const res = await fetch(exaEndpoint(path, base), {
    method: "POST",
    headers: exaHeaders(apiKey, base ? auth.gatewayToken : undefined),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Exa ${path} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as T;
}

function cleanResult(r: Partial<ExaResult>): ExaResult | null {
  if (!r.url || !r.title) return null;
  try {
    const u = new URL(r.url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return {
    id: r.id ?? r.url,
    url: r.url,
    title: r.title.trim(),
    author: r.author?.trim() || undefined,
    publishedDate: r.publishedDate || undefined,
    text: r.text,
    highlights: r.highlights,
  };
}

export async function exaSearch(
  auth: ExaAuth,
  opts: { query: string; numResults: number; includeDomains?: string[]; excludeDomains?: string[]; textChars: number },
): Promise<ExaResult[]> {
  const body = {
    query: opts.query,
    type: "auto",
    numResults: opts.numResults,
    ...(opts.includeDomains ? { includeDomains: opts.includeDomains } : {}),
    ...(opts.excludeDomains ? { excludeDomains: opts.excludeDomains } : {}),
    moderation: true,
    contents: { text: { maxCharacters: opts.textChars }, highlights: { maxCharacters: 600 } },
  };
  const data = await exaPost<{ results?: Partial<ExaResult>[] }>(auth, "/search", body);
  return (data.results ?? []).map(cleanResult).filter((r): r is ExaResult => !!r);
}

/** Full page text for the in-app reader. Returns null when Exa reports the URL failed. */
export async function exaContents(auth: ExaAuth, url: string, maxCharacters: number): Promise<ExaResult | null> {
  const data = await exaPost<{ results?: Partial<ExaResult>[]; statuses?: ExaStatus[] }>(auth, "/contents", {
    urls: [url],
    text: { maxCharacters },
    livecrawl: "fallback",
    livecrawlTimeout: 15_000,
  });
  const status = (data.statuses ?? []).find((s) => s.id === url) ?? data.statuses?.[0];
  if (status && status.status !== "success") return null;
  const raw = (data.results ?? []).find((r) => r.url === url || r.id === url) ?? data.results?.[0];
  const text = raw?.text?.trim();
  if (!raw || !text) return null;
  return {
    id: raw.id ?? url,
    url: raw.url ?? url,
    title: raw.title?.trim() || url,
    author: raw.author?.trim() || undefined,
    publishedDate: raw.publishedDate,
    text: text.slice(0, maxCharacters),
    highlights: raw.highlights,
  };
}

/**
 * Liveness gate via /contents per-URL statuses. HTTP 200 on the request does not mean
 * every URL succeeded; only `status: "success"` entries pass.
 */
export async function exaVerify(auth: ExaAuth, urls: string[]): Promise<{ live: Set<string>; dropped: Map<string, string> }> {
  const live = new Set<string>();
  const dropped = new Map<string, string>();
  if (!urls.length) return { live, dropped };
  const data = await exaPost<{ results?: { id?: string; url?: string }[]; statuses?: ExaStatus[] }>(auth, "/contents", {
    urls,
    text: { maxCharacters: 200 },
    livecrawlTimeout: 8000,
  });
  for (const s of data.statuses ?? []) {
    if (s.status === "success") live.add(s.id);
    else dropped.set(s.id, s.error?.tag ?? "error");
  }
  // Statuses are keyed by requested URL; fall back to result URLs if an entry is missing.
  for (const url of urls) {
    if (live.has(url) || dropped.has(url)) continue;
    if ((data.results ?? []).some((r) => r.url === url || r.id === url)) live.add(url);
    else dropped.set(url, "NO_STATUS");
  }
  return { live, dropped };
}

export const YOUTUBE_DOMAINS = ["youtube.com", "youtu.be"];

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (!u.hostname.endsWith("youtube.com")) return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** YouTube oEmbed: free, no key. 200 = public, embeddable video; returns real title + channel. */
export async function youtubeOembed(videoId: string): Promise<{ title: string; channel: string } | null> {
  const res = await fetch(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    { signal: AbortSignal.timeout(8000) },
  ).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { title?: string; author_name?: string } | null;
  return body?.title ? { title: body.title, channel: body.author_name ?? "" } : null;
}

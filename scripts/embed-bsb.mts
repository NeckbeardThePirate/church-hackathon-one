#!/usr/bin/env node
/**
 * Backfill embeddings into Vectorize via the running app.
 *   npm run dev            (in another terminal)
 *   node --experimental-strip-types scripts/embed-bsb.mts --corpus=verses|fathers|confessions [--after=0] [--base=http://localhost:5173]
 * Resumable: pass --after=<last cursor printed>. Upserts are idempotent.
 */
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const base = arg("base") ?? "http://localhost:5173";
const corpus = arg("corpus") ?? "verses";
let cursor: number | null = Number(arg("after") ?? 0);
const token = process.env.ADMIN_TOKEN;
let total = 0;

while (cursor !== null) {
  let attempt = 0;
  for (;;) {
    let error: string;
    try {
      const res = await fetch(`${base}/api/admin/embed-scripture?corpus=${corpus}&after=${cursor}&limit=400`, {
        method: "POST",
        headers: token ? { "x-admin-token": token } : {},
      });
      const body = (await res.json().catch(() => ({}))) as { processed?: number; nextCursor?: number | null; error?: string };
      if (res.ok) {
        total += body.processed ?? 0;
        console.log(`[${corpus}] ${total} embedded (cursor ${cursor} → ${body.nextCursor ?? "done"})`);
        cursor = body.nextCursor ?? null;
        break;
      }
      error = body.error ?? String(res.status);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (++attempt >= 8) throw new Error(`[${corpus}] failed at cursor ${cursor}: ${error}. Resume with --after=${cursor}`);
    console.warn(`[${corpus}] retry ${attempt} at cursor ${cursor}: ${error}`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}
console.log(`[${corpus}] Done. ${total} embedded.`);

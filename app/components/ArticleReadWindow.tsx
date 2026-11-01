"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { articleBlocks, type ArticleBlock, type FetchedArticle } from "../lib/learn/article";
import type { ArticleResource } from "../lib/learn/types";

const cache = new Map<string, FetchedArticle>();

type Props = {
  planId: string;
  article: ArticleResource;
  meta?: string;
  /** Saved scroll depth, 0–100. */
  scroll: number;
  done: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScroll: (percent: number) => void;
  onDone: (done: boolean) => void;
};

function cacheKey(planId: string, url: string): string {
  return `${planId}\n${url}`;
}

function articleDomId(url: string): string {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `article-read-${(hash >>> 0).toString(36)}`;
}

function scrollPercent(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 8) return 100;
  return Math.min(100, Math.max(0, Math.round((el.scrollTop / max) * 100)));
}

function restoreScroll(el: HTMLElement, percent: number) {
  const max = el.scrollHeight - el.clientHeight;
  el.scrollTop = max > 0 ? (percent / 100) * max : 0;
}

function ArticleBlocks({ blocks }: { blocks: ArticleBlock[] }) {
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]!;
    if (block.type === "li") {
      const items: ArticleBlock[] = [];
      const start = i;
      while (i < blocks.length && blocks[i]!.type === "li") {
        items.push(blocks[i]!);
        i += 1;
      }
      nodes.push(
        <ul key={start} className="my-4 list-disc space-y-1.5 pl-5">
          {items.map((item, n) => (
            <li key={n}>{item.text}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (block.type === "h2") {
      nodes.push(
        <h3 key={i} className="mb-2 mt-6 text-xl font-semibold tracking-[-0.02em] first:mt-0">
          {block.text}
        </h3>,
      );
    } else if (block.type === "h3") {
      nodes.push(
        <h4 key={i} className="mb-2 mt-5 text-base font-semibold">
          {block.text}
        </h4>,
      );
    } else if (block.type === "quote") {
      nodes.push(
        <blockquote
          key={i}
          className="my-4 border-l-2 border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] pl-4 italic text-[var(--ink-muted)]"
        >
          {block.text}
        </blockquote>,
      );
    } else {
      nodes.push(
        <p key={i} className="my-3">
          {block.text}
        </p>,
      );
    }
    i += 1;
  }
  return <>{nodes}</>;
}

export function ArticleReadWindow({
  planId,
  article,
  meta,
  scroll,
  done,
  open,
  onOpenChange,
  onScroll,
  onDone,
}: Props) {
  const panelId = articleDomId(article.url);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;
  const pending = useRef<number | null>(null);
  const restored = useRef(false);

  const [body, setBody] = useState<FetchedArticle | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(scroll);

  useEffect(() => {
    if (!open) setLive(done ? 100 : scroll);
  }, [open, scroll, done]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && panelRef.current?.contains(document.activeElement)) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const key = cacheKey(planId, article.url);
    const cached = cache.get(key);
    if (cached) {
      setBody(cached);
      setStatus("ready");
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setStatus("loading");
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/learn/plans/${planId}/articles`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: article.url }),
          signal: ctrl.signal,
        });
        const payload = (await res.json().catch(() => null)) as (FetchedArticle & { error?: string }) | null;
        if (!res.ok || !payload || typeof payload.text !== "string") {
          if (ctrl.signal.aborted) return;
          throw new Error(payload?.error || "Couldn't load this article.");
        }
        const next: FetchedArticle = {
          url: article.url,
          title: payload.title || article.title,
          author: typeof payload.author === "string" ? payload.author : undefined,
          siteName: typeof payload.siteName === "string" ? payload.siteName : undefined,
          text: payload.text,
          truncated: payload.truncated === true,
        };
        cache.set(key, next);
        if (ctrl.signal.aborted) return;
        setBody(next);
        setStatus("ready");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Couldn't load this article.");
      }
    })();
    return () => ctrl.abort();
  }, [open, planId, article.url, article.title, attempt]);

  useEffect(() => {
    if (!open) {
      restored.current = false;
      return;
    }
    if (!body || restored.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    restored.current = true;
    const percent = scroll;
    let inner = 0;
    const frame = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const node = scrollerRef.current;
        if (!node) return;
        restoreScroll(node, percent);
        const next = scrollPercent(node);
        setLive(next);
        if (next !== percent) onScrollRef.current(next);
        node.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(inner);
    };
  }, [open, body, scroll]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!open || !body || !el) return;
    let timer: number | undefined;
    const handle = () => {
      const next = scrollPercent(el);
      setLive(next);
      pending.current = next;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        pending.current = null;
        onScrollRef.current(next);
      }, 150);
    };
    el.addEventListener("scroll", handle, { passive: true });
    return () => {
      el.removeEventListener("scroll", handle);
      if (timer) window.clearTimeout(timer);
      if (pending.current != null) {
        const flush = pending.current;
        pending.current = null;
        onScrollRef.current(flush);
      }
    };
  }, [open, body]);

  const shown = done ? 100 : live;
  const readLabel = open ? "Close" : done ? "Read again" : live > 0 ? "Continue" : "Read";
  const blocks = body ? articleBlocks(body.text) : [];
  const nearEnd = live >= 90 && !done;

  return (
    <li
      className={`rounded-xl border bg-[color-mix(in_srgb,var(--sidebar)_90%,var(--canvas))] px-4 py-3 ${
        open ? "border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]" : "border-[var(--line)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls={panelId}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block text-sm font-medium leading-snug text-[var(--ink)]">{article.title}</span>
        </button>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs font-medium text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] underline-offset-2 hover:underline"
        >
          Original
        </a>
      </div>
      {meta ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{meta}</p> : null}
      {article.review ? <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{article.review}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div
          className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-[var(--line)]"
          role="progressbar"
          aria-valuenow={shown}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={done ? `${article.title} complete` : `${shown} percent of ${article.title} read`}
        >
          <div
            className="h-full rounded-full bg-[color-mix(in_srgb,var(--accent)_78%,var(--ink))] transition-[width] duration-300 ease-out"
            style={{ width: `${shown}%` }}
          />
        </div>
        {done || live > 0 ? (
          <span className="text-right text-[11px] tabular-nums text-[var(--ink-muted)]">
            {done ? "Complete" : `${live}%`}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="rounded-md border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] px-2.5 py-1 text-xs font-medium text-[var(--ink)]"
        >
          {readLabel}
        </button>
        <button
          type="button"
          aria-pressed={done}
          onClick={() => onDone(!done)}
          className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
            done
              ? "border-[color-mix(in_srgb,#6b9f7a_50%,var(--line))] bg-[color-mix(in_srgb,#6b9f7a_18%,var(--sidebar))] text-[color-mix(in_srgb,#6b9f7a_85%,var(--ink))]"
              : nearEnd
                ? "border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] text-[var(--ink)]"
                : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
          }`}
        >
          {done ? "Completed" : "Mark complete"}
        </button>
      </div>

      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          role="region"
          aria-label={article.title}
          className="mt-3 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--canvas)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2">
            <p className="min-w-0 truncate text-[11px] text-[var(--ink-muted)]">
              {body?.author ? `${body.author} · ` : ""}
              {article.siteName || body?.siteName || "Article"}
            </p>
            <p className="shrink-0 text-[11px] tabular-nums text-[var(--ink-muted)]">{done ? "Complete" : `${live}%`}</p>
          </div>
          <div className="h-0.5 bg-[var(--line)]" aria-hidden>
            <div
              className="h-full bg-[color-mix(in_srgb,var(--accent)_78%,var(--ink))] transition-[width] duration-150 ease-out"
              style={{ width: `${shown}%` }}
            />
          </div>
          <div
            ref={scrollerRef}
            tabIndex={0}
            className="max-h-[min(70vh,34rem)] overflow-y-auto overscroll-contain px-5 py-4 text-[17px] leading-[1.7] text-[var(--ink)] outline-none [scrollbar-gutter:stable] focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--accent)_55%,transparent)]"
            style={{ fontFamily: "var(--font-serif), Georgia, 'Iowan Old Style', serif" }}
          >
            {!body && status !== "error" ? (
              <div className="space-y-3 font-sans" aria-busy="true" aria-live="polite">
                <p className="text-sm text-[var(--ink-muted)]">Pulling in the article…</p>
                <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--sidebar-active)]" />
                <div className="h-3 w-full animate-pulse rounded bg-[var(--sidebar-active)]" />
                <div className="h-3 w-11/12 animate-pulse rounded bg-[var(--sidebar-active)]" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--sidebar-active)]" />
              </div>
            ) : null}
            {status === "error" ? (
              <div className="font-sans text-sm text-[var(--ink-muted)]">
                <p>{error || "Couldn't load this article."}</p>
                <button
                  type="button"
                  onClick={() => {
                    cache.delete(cacheKey(planId, article.url));
                    setBody(null);
                    setAttempt((n) => n + 1);
                  }}
                  className="mt-3 rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--ink)]"
                >
                  Try again
                </button>
              </div>
            ) : null}
            {body && status !== "error" ? (
              <>
                <ArticleBlocks blocks={blocks} />
                {body.truncated ? (
                  <p className="mt-6 font-sans text-sm text-[var(--ink-muted)]">
                    This is as much as we could pull in.{" "}
                    <a href={article.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                      Read the rest on the original page
                    </a>
                    .
                  </p>
                ) : null}
                {!body.truncated && body.text.length < 500 ? (
                  <p className="mt-6 font-sans text-sm text-[var(--ink-muted)]">
                    Only a short extract was available.{" "}
                    <a href={article.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                      Open the full page
                    </a>
                    .
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

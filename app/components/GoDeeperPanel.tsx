"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { bibleGatewayEsvUrl } from "../lib/bible/bible-gateway";
import type { DeeperCrossReference, GoDeeperResult } from "../lib/server/go-deeper";
import type { ReadingItem } from "../lib/server/further-reading";
import type { ConfessionHit, FatherHit, HitSource } from "../lib/server/library-search";
import type { ScriptureHit, SearchMode } from "../lib/server/scripture-search";
import type { DeeperChatMessage } from "../lib/projects";
import { ChatMarkdown } from "./ChatMarkdown";

/* ───────────────────────────── types & caches ───────────────────────────── */

export type DeeperInsert =
  | { kind: "reference"; reference: string }
  | { kind: "quote"; text: string; attribution: string };

type ChatMessage = DeeperChatMessage;

type GoDeeperPanelProps = {
  text: string;
  /** Plain text of nearby blocks, for the AI explanation's context. */
  before?: string;
  after?: string;
  noteKind?: string;
  /** Saved state from the deeper block, so reloads don't refetch or lose the conversation. */
  initialData?: GoDeeperResult;
  initialMessages?: ChatMessage[];
  /** Called when sources load or an AI turn finishes. */
  onPersist: (patch: { data?: GoDeeperResult; messages?: ChatMessage[] }) => void;
  onInsert: (item: DeeperInsert) => void;
  onMinimize: () => void;
  onMakePage: (state: { data: GoDeeperResult | null; messages: ChatMessage[] }) => void;
  onDiscard: () => void;
};

type Tab = "scripture" | "fathers" | "confessions" | "reading" | "search";
type Corpus = "scripture" | "fathers" | "confessions";
type AnyHit = ScriptureHit | FatherHit | ConfessionHit;

const TABS: { id: Tab; label: string }[] = [
  { id: "scripture", label: "Scripture" },
  { id: "fathers", label: "Fathers" },
  { id: "confessions", label: "Confessions" },
  { id: "reading", label: "Read & Watch" },
  { id: "search", label: "Search" },
];


/* ───────────────────────────── helpers ───────────────────────────── */

function sourceBadge(sources: HitSource[]): string {
  const labels = { verse: "on this verse", semantic: "meaning", text: "words" } as const;
  return sources.map((s) => labels[s]).join(" + ");
}

function fatherAttribution(hit: FatherHit): string {
  return [hit.author, hit.work, hit.year ? `c. ${hit.year}` : null].filter(Boolean).join(", ");
}

function confessionAttribution(hit: ConfessionHit): string {
  return [hit.document, hit.label].filter(Boolean).join(" ");
}

function century(year: number | null): string | null {
  if (!year) return null;
  const c = Math.ceil(year / 100);
  const suffix =
    c % 10 === 1 && c !== 11 ? "st" : c % 10 === 2 && c !== 12 ? "nd" : c % 10 === 3 && c !== 13 ? "rd" : "th";
  return `${c}${suffix} c.`;
}

function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w) && !["Of", "The"].includes(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}

function titleCase(text: string | null): string | null {
  if (!text) return text;
  return text === text.toUpperCase() ? text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : text;
}

/** Splits "Q. … A. …" catechism text. */
function splitQA(text: string): { q: string; a: string } | null {
  const m = text.match(/^Q\.\s*(.+?)\s+A\.\s*([\s\S]+)$/);
  return m ? { q: m[1]!, a: m[2]! } : null;
}

const firstWord = (s: string) => s.toLowerCase().split(" (")[0]!.split(/\s+/)[0]!;

/* ───────────────────────────── main ───────────────────────────── */

export function GoDeeperPanel({
  text,
  before,
  after,
  noteKind,
  initialData,
  initialMessages,
  onPersist,
  onInsert,
  onMinimize,
  onMakePage,
  onDiscard,
}: GoDeeperPanelProps) {
  const [data, setData] = useState<GoDeeperResult | null>(initialData ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("scripture");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/study/deeper", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const json = (await response.json()) as GoDeeperResult & { error?: string };
        if (!response.ok) throw new Error(json.error ?? "Request failed");
        if (cancelled) return;
        setData(json);
        persistRef.current({ data: json });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Request failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (sidebarOpen) setSidebarOpen(false);
      else onMinimize();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMinimize, sidebarOpen]);

  /** Citation chip in the explanation → open the matching source in the sidebar. */
  const openCitation = useCallback(
    (label: string) => {
      if (!data) return;
      const l = label.toLowerCase();
      const ref = data.crossReferences.find((r) => l.includes(r.reference.toLowerCase().split(/[–-]/)[0]!));
      const confession = data.confessions.find(
        (c) => l.includes(firstWord(c.document)) && (!c.label || l.includes(c.label.toLowerCase().replace(/^ch\. /, ""))),
      );
      const father = data.fathers.find((f) => l.includes(firstWord(f.author)));
      if (ref) {
        setTab("scripture");
        setFocusKey(`x:${ref.reference}`);
      } else if (confession) {
        setTab("confessions");
        setFocusKey(`c:${confession.id}`);
      } else if (father) {
        setTab("fathers");
        setFocusKey(`f:${father.id}`);
      } else {
        return;
      }
      setSidebarOpen(true);
    },
    [data],
  );

  return (
    <>
      <DeeperThread
        text={text}
        before={before}
        after={after}
        noteKind={noteKind}
        data={data}
        error={error}
        messages={messages}
        setMessages={setMessages}
        onTurnDone={(final) => persistRef.current({ messages: final })}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onCitation={openCitation}
        onMinimize={onMinimize}
        onMakePage={() => onMakePage({ data, messages })}
        onDiscard={onDiscard}
      />
      {mounted && sidebarOpen
        ? createPortal(
            <DeeperSidebar
              data={data}
              error={error}
              text={text}
              tab={tab}
              onTab={setTab}
              focusKey={focusKey}
              onInsert={onInsert}
              onClose={() => setSidebarOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/* ───────────────────────────── inline thread ───────────────────────────── */

function DeeperThread({
  text,
  before,
  after,
  noteKind,
  data,
  error,
  messages,
  setMessages,
  onTurnDone,
  sidebarOpen,
  onToggleSidebar,
  onCitation,
  onMinimize,
  onMakePage,
  onDiscard,
}: {
  text: string;
  before?: string;
  after?: string;
  noteKind?: string;
  data: GoDeeperResult | null;
  error: string | null;
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  onTurnDone: (messages: ChatMessage[]) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onCitation: (label: string) => void;
  onMinimize: () => void;
  onMakePage: () => void;
  onDiscard: () => void;
}) {
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sources = useMemo(
    () =>
      data && {
        theme: data.theme,
        crossReferences: data.crossReferences.map(({ reference, text: t, note }) => ({ reference, text: t, note })),
        fathers: data.fathers.map(({ author, work, year, passage, text: t, condemned }) => ({
          author,
          work,
          year,
          passage,
          text: t,
          condemned,
        })),
        confessions: data.confessions.map(({ document, label, text: t }) => ({ document, label, text: t })),
      },
    [data],
  );

  /** Streams one assistant turn. The first assistant turn is the explanation; `history` is everything after the prompt. */
  const stream = useCallback(
    async (history: ChatMessage[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setChatError(null);
      setMessages([...history, { role: "assistant", content: "" }]);
      try {
        const response = await fetch("/api/study/deeper/chat", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ blockText: text, before, after, noteKind, sources, messages: history }),
        });
        if (!response.ok || !response.body) {
          const json = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? `Request failed (${response.status})`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        let final: ChatMessage[] = history;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          final = [...history, { role: "assistant", content: acc }];
          setMessages(final);
        }
        if (!acc.trim()) throw new Error("The model returned an empty reply.");
        onTurnDone(final);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setChatError(err instanceof Error ? err.message : "Chat failed");
        setMessages((prev) => (prev.at(-1)?.content ? prev : prev.slice(0, -1)));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setStreaming(false);
        }
      }
    },
    [after, before, noteKind, onTurnDone, setMessages, sources, text],
  );

  // Kick off the explanation once sources arrive (or right away if the search failed).
  useEffect(() => {
    if (started.current || messages.length) return;
    if (!data && !error) return;
    started.current = true;
    void stream([]);
  }, [data, error, messages.length, stream]);

  const send = () => {
    const content = draft.trim();
    if (!content || streaming) return;
    setDraft("");
    void stream([...messages, { role: "user", content }]);
  };

  const retry = () => {
    const history = messages.at(-1)?.role === "assistant" ? messages.slice(0, -1) : messages;
    void stream(history);
  };

  const [explanation, ...rest] = messages;

  return (
    <section
      className="go-deeper relative my-3 overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--accent)_30%,var(--line))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent)_7%,var(--sidebar)),var(--sidebar))] shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]"
      contentEditable={false}
      aria-label="Go deeper"
    >
      <header className="flex items-center justify-between gap-2 px-4 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[11px] text-[var(--accent)]">
            ✦
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">Going deeper</p>
            {data?.theme ? <p className="truncate text-sm font-medium text-[var(--ink)]">{data.theme}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            {sidebarOpen ? "Hide sources" : `Sources${data ? ` · ${countSources(data)}` : ""}`}
          </button>
          <button
            type="button"
            onClick={onMakePage}
            disabled={streaming || !messages[0]?.content}
            title="Turn this study into its own sub-page"
            className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-40"
          >
            ↗ Page
          </button>
          <button
            type="button"
            onClick={onMinimize}
            title="Minimize (Esc). It stays on this page."
            className="rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
            aria-label="Minimize go deeper"
          >
            —
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Discard this Go Deeper thread? The explanation and chat will be removed.")) onDiscard();
            }}
            title="Discard thread"
            className="rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-red-300"
            aria-label="Discard go deeper thread"
          >
            ✕
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="max-h-[520px] overflow-y-auto px-4 pb-2 pt-3 [scrollbar-gutter:stable]">
        {!explanation ? (
          <div className="space-y-2" aria-busy>
            <p className="text-xs text-[var(--ink-muted)]">
              {data || error ? "Writing an explanation…" : "Searching Scripture, the fathers and the confessions…"}
            </p>
            {[92, 80, 86, 60].map((w, i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-[var(--sidebar-active)]" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : explanation.content ? (
          <ChatMarkdown text={explanation.content} onCitation={onCitation} streaming={streaming && rest.length === 0} />
        ) : (
          <TypingDots />
        )}

        {rest.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="mt-4 flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--sidebar-active)] px-3 py-2 text-sm text-[var(--ink)]">
                {m.content}
              </p>
            </div>
          ) : (
            <div key={i} className="mt-4">
              {m.content ? (
                <ChatMarkdown text={m.content} onCitation={onCitation} streaming={streaming && i === rest.length - 1} />
              ) : (
                <TypingDots />
              )}
            </div>
          ),
        )}

        {chatError ? (
          <p className="mt-3 text-sm text-red-400">
            {chatError}{" "}
            <button type="button" className="underline" onClick={retry}>
              Retry
            </button>
          </p>
        ) : null}
      </div>

      <form
        className="flex items-end gap-2 border-t border-[var(--line)] px-3 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          value={draft}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={explanation ? "Ask a follow-up…" : "Ask about this passage…"}
          className="max-h-32 min-h-[36px] flex-1 resize-none rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_srgb,var(--accent)_60%,var(--line))]"
        />
        {streaming ? (
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              abortRef.current = null;
              setStreaming(false);
            }}
            className="h-9 rounded-xl border border-[var(--line)] px-3 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            className="h-9 rounded-xl bg-[var(--accent)] px-3 text-xs font-semibold text-[#1b1a17] disabled:opacity-40"
          >
            Ask
          </button>
        )}
      </form>
    </section>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-2" aria-label="Thinking">
      {[0, 1, 2].map((d) => (
        <span
          key={d}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ink-muted)]"
          style={{ animationDelay: `${d * 120}ms` }}
        />
      ))}
    </span>
  );
}

function countSources(data: GoDeeperResult): number {
  return data.crossReferences.length + data.fathers.length + data.confessions.length + data.furtherReading.length;
}

/* ───────────────────────────── sidebar ───────────────────────────── */

function DeeperSidebar({
  data,
  error,
  text,
  tab,
  onTab,
  focusKey,
  onInsert,
  onClose,
}: {
  data: GoDeeperResult | null;
  error: string | null;
  text: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  focusKey: string | null;
  onInsert: (item: DeeperInsert) => void;
  onClose: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusKey) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("ring-1", "ring-[var(--accent)]");
    const t = window.setTimeout(() => el.classList.remove("ring-1", "ring-[var(--accent)]"), 1600);
    return () => window.clearTimeout(t);
  }, [focusKey, tab]);

  const counts: Partial<Record<Tab, number>> = data
    ? {
        scripture: data.crossReferences.length,
        fathers: data.fathers.length,
        confessions: data.confessions.length,
        reading: data.furtherReading.length,
      }
    : {};

  const confessionGroups = useMemo(() => {
    const groups = new Map<string, GoDeeperResult["confessions"]>();
    for (const c of data?.confessions ?? []) groups.set(c.document, [...(groups.get(c.document) ?? []), c]);
    return [...groups.entries()];
  }, [data]);

  return (
    <aside
      className="go-deeper fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-[var(--line)] bg-[var(--sidebar)] shadow-[-12px_0_40px_-16px_rgba(0,0,0,0.6)] sm:w-[400px] xl:w-[440px]"
      aria-label="Go deeper sources"
    >
      <header className="border-b border-[var(--line)] px-4 pb-0 pt-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Sources for</p>
            <p className="line-clamp-2 text-sm font-medium leading-snug text-[var(--ink)]">{data?.theme || text}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-1.5 py-0.5 text-sm text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
            aria-label="Close sources"
          >
            ✕
          </button>
        </div>
        <nav className="-mb-px flex gap-3 overflow-x-auto text-xs [scrollbar-width:none]">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => onTab(id)}
              className={`shrink-0 border-b-2 pb-2 font-medium transition-colors ${
                tab === id
                  ? "border-[var(--accent)] text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {label}
              {counts[id] !== undefined ? <span className="ml-1 tabular-nums opacity-50">{counts[id]}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
        {error ? <p className="py-3 text-sm text-red-400">{error}</p> : null}
        {!data && !error && tab !== "search" ? <SkeletonCards /> : null}

        {data && tab === "scripture" ? (
          <div className="space-y-3">
            {data.crossReferences.length === 0 ? <Empty /> : null}
            {data.crossReferences.map((item) => (
              <ScriptureCard key={item.reference} item={item} onInsert={onInsert} />
            ))}
          </div>
        ) : null}

        {data && tab === "fathers" ? (
          <div className="space-y-3">
            {data.fathers.length === 0 ? <Empty /> : null}
            {data.fathers.map((item) => (
              <FatherCard key={item.id} hit={item} note={item.note} onInsert={onInsert} />
            ))}
            <Footnote>
              Translations via HistoricalChristianFaith. AI picked and annotated the matches; read the full source before
              teaching.
            </Footnote>
          </div>
        ) : null}

        {data && tab === "confessions" ? (
          <div className="space-y-5">
            {confessionGroups.length === 0 ? <Empty /> : null}
            {confessionGroups.map(([doc, items]) => (
              <div key={doc}>
                <p className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
                  {doc}
                  {items[0]?.year ? (
                    <span className="font-normal normal-case tracking-normal opacity-70">{items[0].year}</span>
                  ) : null}
                </p>
                <div className="space-y-2.5">
                  {items.map((item) => (
                    <ConfessionCard key={item.id} hit={item} note={item.note} onInsert={onInsert} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {data && tab === "reading" ? <ReadingList items={data.furtherReading ?? []} /> : null}

        {tab === "search" ? (
          <LibrarySearch seed={text} initialHits={data?.related ?? null} onInsert={onInsert} />
        ) : null}
      </div>
    </aside>
  );
}

/* ───────────────────────────── cards ───────────────────────────── */

function Card({ dataKey, children, actions }: { dataKey?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <article
      data-key={dataKey}
      className="rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--canvas)_55%,var(--sidebar))] p-3 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]"
    >
      {children}
      {actions ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </article>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
    >
      {children}
    </button>
  );
}

function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
    >
      {children}
    </a>
  );
}

function Chip({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "warn" }) {
  const cls =
    tone === "warn"
      ? "border-red-400/40 text-red-300"
      : tone === "accent"
        ? "border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] text-[color-mix(in_srgb,var(--accent)_90%,var(--ink))]"
        : "border-[var(--line)] text-[var(--ink-muted)]";
  return <span className={`rounded-full border px-1.5 py-[1px] text-[10px] leading-4 ${cls}`}>{children}</span>;
}

function Expandable({ text, limit = 360, className = "" }: { text: string; limit?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  return (
    <p className={className}>
      {long && !open ? `${text.slice(0, limit).replace(/\s+\S*$/, "")}…` : text}
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-1 font-sans text-[11px] text-[color-mix(in_srgb,var(--accent)_85%,var(--ink))] hover:underline"
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </p>
  );
}

const SERIF = "font-[Georgia,'Iowan_Old_Style','Times_New_Roman',serif]";

function ScriptureCard({ item, onInsert }: { item: DeeperCrossReference; onInsert: (i: DeeperInsert) => void }) {
  return (
    <Card
      dataKey={`x:${item.reference}`}
      actions={
        <>
          <ActionButton onClick={() => onInsert({ kind: "reference", reference: item.reference })}>+ Insert</ActionButton>
          <ActionLink href={bibleGatewayEsvUrl(item.reference)}>Read in context ↗</ActionLink>
        </>
      }
    >
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--ink)]">{item.reference}</h3>
        {item.verified ? <Chip>BSB</Chip> : <Chip tone="warn">unverified</Chip>}
      </div>
      {item.text ? (
        <blockquote
          className={`${SERIF} border-l-2 border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] pl-3 text-[0.95rem] leading-relaxed text-[var(--ink)]`}
        >
          {item.text}
        </blockquote>
      ) : null}
      {item.note ? <p className="mt-2 text-xs leading-relaxed text-[var(--ink-muted)]">{item.note}</p> : null}
    </Card>
  );
}

function FatherCard({ hit, note, onInsert }: { hit: FatherHit; note?: string; onInsert: (i: DeeperInsert) => void }) {
  const era = century(hit.year);
  return (
    <Card
      dataKey={`f:${hit.id}`}
      actions={
        <>
          <ActionButton onClick={() => onInsert({ kind: "quote", text: hit.text, attribution: fatherAttribution(hit) })}>
            + Insert quote
          </ActionButton>
          {hit.sourceUrl ? <ActionLink href={hit.sourceUrl}>Source ↗</ActionLink> : null}
        </>
      }
    >
      <div className="mb-2 flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,var(--sidebar-active))] text-[11px] font-semibold text-[var(--accent)]">
          {initials(hit.author) || "✝"}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight text-[var(--ink)]">{hit.author}</h3>
          <p className="truncate text-xs italic text-[var(--ink-muted)]">{titleCase(hit.work) ?? "—"}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {era ? <Chip>{era}</Chip> : null}
            <Chip tone="accent">on {hit.passage}</Chip>
            {hit.condemned ? <Chip tone="warn">condemned by council</Chip> : null}
            {!note ? <Chip>{sourceBadge(hit.sources)}</Chip> : null}
          </div>
        </div>
      </div>
      <Expandable
        text={hit.text}
        className={`${SERIF} text-[0.92rem] leading-relaxed text-[color-mix(in_srgb,var(--ink)_90%,transparent)]`}
      />
      {note ? (
        <p className="mt-2 rounded-lg bg-[var(--sidebar-active)] px-2.5 py-1.5 text-xs leading-relaxed text-[var(--ink-muted)]">
          <span className="font-semibold text-[var(--ink)]">Why: </span>
          {note}
        </p>
      ) : null}
    </Card>
  );
}

function ConfessionCard({
  hit,
  note,
  onInsert,
}: {
  hit: ConfessionHit;
  note?: string;
  onInsert: (i: DeeperInsert) => void;
}) {
  const qa = splitQA(hit.text);
  return (
    <Card
      dataKey={`c:${hit.id}`}
      actions={
        <ActionButton
          onClick={() => onInsert({ kind: "quote", text: hit.text, attribution: confessionAttribution(hit) })}
        >
          + Insert
        </ActionButton>
      }
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {hit.label ? <Chip tone="accent">{hit.label}</Chip> : null}
        {hit.title && !qa ? <span className="text-xs font-medium text-[var(--ink)]">{hit.title}</span> : null}
        {!note ? <Chip>{sourceBadge(hit.sources)}</Chip> : null}
      </div>
      {qa ? (
        <div className={`${SERIF} space-y-1 text-[0.92rem] leading-relaxed`}>
          <p className="font-semibold text-[var(--ink)]">{qa.q}</p>
          <Expandable text={qa.a} className="text-[color-mix(in_srgb,var(--ink)_88%,transparent)]" />
        </div>
      ) : (
        <Expandable
          text={hit.text}
          className={`${SERIF} text-[0.92rem] leading-relaxed text-[color-mix(in_srgb,var(--ink)_88%,transparent)]`}
        />
      )}
      {note ? <p className="mt-2 text-xs leading-relaxed text-[var(--ink-muted)]">{note}</p> : null}
    </Card>
  );
}

function ReadingList({ items }: { items: ReadingItem[] }) {
  if (!items.length) return <Empty />;
  const launchers = items.filter((i) => i.kind === "search");
  const videos = items.filter((i) => i.kind === "video");
  const articles = items.filter((i) => i.kind === "article");

  return (
    <div className="space-y-5">
      {videos.length ? (
        <Section title="Videos">
          {videos.map((v) => (
            <a
              key={v.url}
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 rounded-xl border border-[var(--line)] p-2 hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]"
            >
              <div className="relative grid h-[54px] w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--sidebar-active)]">
                {v.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : null}
                <span className="absolute grid h-6 w-6 place-items-center rounded-full bg-black/60 text-[10px] text-white">
                  ▶
                </span>
              </div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium leading-snug text-[var(--ink)]">{v.title}</p>
                <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                  {v.source}
                  {v.age ? ` · ${v.age}` : ""}
                </p>
              </div>
            </a>
          ))}
        </Section>
      ) : null}

      {articles.length ? (
        <Section title="Articles">
          {articles.map((a) => (
            <a
              key={a.url}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-[var(--line)] p-3 hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]"
            >
              <p className="text-[11px] text-[var(--ink-muted)]">
                {a.source}
                {a.age ? ` · ${a.age}` : ""}
              </p>
              <p className="mt-1 text-sm font-medium leading-snug text-[var(--ink)]">{a.title}</p>
              {a.description ? (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--ink-muted)]">{a.description}</p>
              ) : null}
            </a>
          ))}
        </Section>
      ) : null}

      {launchers.length ? (
        <Section title="Explore on trusted sites">
          <div className="grid grid-cols-2 gap-2">
            {launchers.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-[var(--line)] p-2.5 hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))]"
              >
                <p className="text-xs font-semibold text-[var(--ink)]">
                  {l.source} <span className="font-normal text-[var(--ink-muted)]">↗</span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--ink-muted)]">
                  {l.description}: “{l.title}”
                </p>
              </a>
            ))}
          </div>
          <Footnote>Set BRAVE_SEARCH_API_KEY to list specific articles and videos here.</Footnote>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">{title}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function SkeletonCards() {
  return (
    <div className="space-y-3" aria-busy>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2 rounded-xl border border-[var(--line)] p-3">
          <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--sidebar-active)]" />
          <div className="h-3 w-full animate-pulse rounded bg-[var(--sidebar-active)]" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--sidebar-active)]" />
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return <p className="py-4 text-center text-sm text-[var(--ink-muted)]">Nothing found for this block.</p>;
}

function Footnote({ children }: { children: ReactNode }) {
  return <p className="pt-1 text-[10px] leading-relaxed text-[var(--ink-muted)]">{children}</p>;
}

/* ───────────────────────────── search tab ───────────────────────────── */

function LibrarySearch({
  seed,
  initialHits,
  onInsert,
}: {
  seed: string;
  initialHits: ScriptureHit[] | null;
  onInsert: (item: DeeperInsert) => void;
}) {
  const [query, setQuery] = useState("");
  const [corpus, setCorpus] = useState<Corpus>("scripture");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [hits, setHits] = useState<AnyHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (q: string, c: Corpus, m: SearchMode) => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q, corpus: c, mode: m, k: "15" });
      const response = await fetch(`/api/library/search?${params.toString()}`, { credentials: "include" });
      const json = (await response.json()) as { hits?: AnyHit[]; error?: string };
      if (!response.ok) throw new Error(json.error ?? "Search failed");
      setHits(json.hits ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  const shown: AnyHit[] | null = hits ?? (corpus === "scripture" ? initialHits : null);

  const switchCorpus = (next: Corpus) => {
    setCorpus(next);
    setHits(null);
    const q = query.trim() || (next === "scripture" ? "" : seed);
    if (q) void run(q, next, mode);
  };

  return (
    <div>
      <div className="sticky -top-3 z-10 -mx-4 bg-[var(--sidebar)] px-4 pb-3 pt-1">
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void run(query, corpus, mode);
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Search by meaning, words, or a verse…"
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-2.5 py-1.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
          />
          <select
            value={mode}
            onChange={(event) => {
              const next = event.target.value as SearchMode;
              setMode(next);
              if (query.trim()) void run(query, corpus, next);
            }}
            className="rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-1.5 text-xs text-[var(--ink-muted)]"
            aria-label="Search mode"
          >
            <option value="hybrid">Hybrid</option>
            <option value="semantic">Meaning</option>
            <option value="text">Exact words</option>
          </select>
        </form>
        <div className="mt-2 flex gap-1">
          {(["scripture", "fathers", "confessions"] as Corpus[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => switchCorpus(c)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                corpus === c
                  ? "border-[var(--accent)] text-[var(--ink)]"
                  : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {c === "scripture" ? "Scripture" : c === "fathers" ? "Fathers" : "Confessions"}
            </button>
          ))}
        </div>
      </div>
      {!hits && !query && shown ? (
        <p className="pb-2 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-muted)]">Related to this block</p>
      ) : null}
      {error ? <p className="py-2 text-sm text-red-400">{error}</p> : null}
      {busy || !shown ? (
        <SkeletonCards />
      ) : shown.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-3">
          {shown.map((hit) =>
            "author" in hit ? (
              <FatherCard key={hit.id} hit={hit} onInsert={onInsert} />
            ) : "document" in hit ? (
              <ConfessionCard key={hit.id} hit={hit} onInsert={onInsert} />
            ) : (
              <ScriptureCard
                key={hit.reference}
                item={{ reference: hit.reference, text: hit.text, note: sourceBadge(hit.sources), verified: true }}
                onInsert={onInsert}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

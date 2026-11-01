"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildLearnChatContext,
  focusLabel,
  type LearnChatMessage,
} from "../lib/learn/agent-context";
import type { LearnLocation } from "../lib/learn/plan-progress";
import type { LearnPlan } from "../lib/learn/types";
import { ChatMarkdown } from "./ChatMarkdown";

const STORAGE_PREFIX = "learn-agent:";

type Props = {
  projectId: string;
  plan: LearnPlan;
  location: LearnLocation;
};

function readMessages(projectId: string): LearnChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is LearnChatMessage =>
        !!m &&
        typeof m === "object" &&
        (m as LearnChatMessage).role &&
        ((m as LearnChatMessage).role === "user" || (m as LearnChatMessage).role === "assistant") &&
        typeof (m as LearnChatMessage).content === "string",
    );
  } catch {
    return [];
  }
}

function writeMessages(projectId: string, messages: LearnChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(messages.slice(-40)));
  } catch {
    /* quota */
  }
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

export function LearnAgentFloat({ projectId, plan, location }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<LearnChatMessage[]>(() => readMessages(projectId));
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextKey = `${location.screen}:${location.lessonId ?? ""}`;

  const chatContext = useMemo(() => buildLearnChatContext(plan, location), [plan, location]);
  const contextTitle = focusLabel(chatContext);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setMessages(readMessages(projectId));
  }, [projectId]);

  useEffect(() => {
    writeMessages(projectId, messages);
  }, [projectId, messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const streamReply = useCallback(
    async (history: LearnChatMessage[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setChatError(null);
      setMessages([...history, { role: "assistant", content: "" }]);
      try {
        const response = await fetch("/api/learn/chat", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ context: chatContext, messages: history }),
        });
        if (!response.ok || !response.body) {
          const json = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? `Request failed (${response.status})`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages([...history, { role: "assistant", content: acc }]);
        }
        if (!acc.trim()) throw new Error("The model returned an empty reply.");
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
    [chatContext],
  );

  const send = () => {
    const content = draft.trim();
    if (!content || streaming) return;
    setDraft("");
    const next: LearnChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    void streamReply(next);
  };

  const retry = () => {
    const history =
      messages.at(-1)?.role === "assistant" && !messages.at(-1)?.content
        ? messages.slice(0, -1)
        : messages.at(-1)?.role === "assistant"
          ? messages.slice(0, -1)
          : messages;
    if (history.at(-1)?.role !== "user") return;
    void streamReply(history);
  };

  const clearChat = () => {
    if (streaming) abortRef.current?.abort();
    setMessages([]);
    setChatError(null);
  };

  if (!mounted) return null;

  const panel = open ? (
    <div
      className="learn-agent fixed bottom-20 right-5 z-40 flex w-[min(100vw-2.5rem,380px)] flex-col overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--accent)_30%,var(--line))] bg-[var(--sidebar)] shadow-[0_16px_48px_-16px_rgba(0,0,0,0.65)]"
      role="dialog"
      aria-label="Course tutor"
    >
      <header className="flex items-start justify-between gap-2 border-b border-[var(--line)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">Course tutor</p>
          <p className="truncate text-sm font-medium text-[var(--ink)]" title={contextTitle}>
            {contextTitle}
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">Uses this lesson&apos;s readings &amp; notes</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={clearChat}
            disabled={streaming || messages.length === 0}
            className="rounded-md px-2 py-1 text-[10px] text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)] disabled:opacity-40"
            title="Clear conversation"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-2 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
            aria-label="Minimize tutor"
          >
            —
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="min-h-[200px] max-h-[min(52vh,420px)] flex-1 overflow-y-auto px-3 py-2 [scrollbar-gutter:stable]"
      >
        {messages.length === 0 ? (
          <p className="text-sm leading-relaxed text-[var(--ink-muted)]">
            Ask about what you&apos;re studying — teaching points, scripture, linked videos and articles, or quiz ideas.
            Context updates when you change lessons ({contextTitle}).
          </p>
        ) : null}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const streamThis = streaming && isLast && m.role === "assistant";
          return m.role === "user" ? (
            <div key={`${contextKey}-u-${i}`} className="mt-3 flex justify-end">
              <div className="max-w-[90%] rounded-2xl rounded-br-md bg-[var(--sidebar-active)] px-3 py-2 text-[var(--ink)]">
                <ChatMarkdown text={m.content} className="text-sm [&_a]:text-[var(--ink)]" />
              </div>
            </div>
          ) : (
            <div key={`${contextKey}-a-${i}`} className="mt-3">
              {m.content ? (
                <ChatMarkdown text={m.content} streaming={streamThis} className="text-sm" />
              ) : (
                <TypingDots />
              )}
            </div>
          );
        })}
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
        className="flex items-end gap-2 border-t border-[var(--line)] px-2.5 py-2"
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
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Ask about this lesson…"
          className="max-h-28 min-h-[36px] flex-1 resize-none rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_srgb,var(--accent)_60%,var(--line))]"
        />
        {streaming ? (
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              abortRef.current = null;
              setStreaming(false);
            }}
            className="h-9 shrink-0 rounded-xl border border-[var(--line)] px-3 text-xs text-[var(--ink-muted)]"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            className="h-9 shrink-0 rounded-xl bg-[var(--accent)] px-3 text-xs font-semibold text-[#1b1a17] disabled:opacity-40"
          >
            Ask
          </button>
        )}
      </form>
    </div>
  ) : null;

  return createPortal(
    <>
      {panel}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="learn-agent fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--sidebar))] py-2 pl-3 pr-4 text-sm font-medium text-[var(--ink)] shadow-[0_8px_28px_-10px_rgba(0,0,0,0.55)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]"
        aria-expanded={open}
        aria-controls={open ? "learn-agent-panel" : undefined}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-xs text-[var(--accent)]">
          ✦
        </span>
        {open ? "Hide tutor" : "Ask tutor"}
      </button>
    </>,
    document.body,
  );
}

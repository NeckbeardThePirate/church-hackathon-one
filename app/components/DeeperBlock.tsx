"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { BlockContent, DeeperState } from "../lib/projects";
import type { GoDeeperResult } from "../lib/server/go-deeper";
import { GoDeeperPanel, type DeeperInsert } from "./GoDeeperPanel";

function summary(state: DeeperState): { title: string; replies: number; sources: number } {
  const data = state.data;
  return {
    title: data?.theme || state.text.slice(0, 80),
    replies: Math.max(0, (state.messages?.filter((m) => m.role === "user").length ?? 0)),
    sources: data
      ? data.crossReferences.length + data.fathers.length + data.confessions.length + (data.furtherReading?.length ?? 0)
      : 0,
  };
}

type DeeperBlockProps = {
  block: BlockContent & { deeper: DeeperState };
  noteKind?: string;
  onChange: (patch: Partial<DeeperState>) => void;
  onExpand: () => void;
  onInsert: (item: DeeperInsert) => void;
  onMakePage: (state: { data: GoDeeperResult | null; messages: DeeperState["messages"] }) => void;
  onDiscard: () => void;
};

/** A Go Deeper thread saved in the page: expanded panel, or a slim chip when minimized. */
export function DeeperBlock({ block, noteKind, onChange, onExpand, onInsert, onMakePage, onDiscard }: DeeperBlockProps) {
  const state = block.deeper;

  if (state.collapsed) {
    const { title, replies, sources } = summary(state);
    return (
      <div className="go-deeper my-1 pl-1" contentEditable={false} data-deeper-id={block.id}>
        <button
          type="button"
          onClick={onExpand}
          className="group inline-flex max-w-full items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--accent)_30%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_7%,var(--sidebar))] py-1 pl-1.5 pr-3 text-xs text-[var(--ink-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--ink)]"
          title="Expand Go Deeper thread"
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[10px] text-[var(--accent)]">
            ✦
          </span>
          <span className="truncate font-medium text-[var(--ink)]">{title}</span>
          {sources ? <span className="shrink-0 opacity-70">· {sources} sources</span> : null}
          {replies ? <span className="shrink-0 opacity-70">· {replies} {replies === 1 ? "question" : "questions"}</span> : null}
          <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">Expand ↓</span>
        </button>
      </div>
    );
  }

  return (
    <div data-deeper-id={block.id}>
      <GoDeeperPanel
        text={state.text}
        before={state.before}
        after={state.after}
        noteKind={noteKind}
        initialData={state.data}
        initialMessages={state.messages}
        onPersist={(patch) => onChange(patch)}
        onInsert={onInsert}
        onMinimize={() => onChange({ collapsed: true })}
        onMakePage={onMakePage}
        onDiscard={onDiscard}
      />
    </div>
  );
}

/** Floating dock listing this page's minimized threads, so they're out of the way but one click away. */
export function DeeperDock({
  threads,
  onOpen,
}: {
  threads: (BlockContent & { deeper: DeeperState })[];
  onOpen: (blockId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const minimized = threads.filter((t) => t.deeper.collapsed);
  if (!mounted || minimized.length === 0) return null;

  return createPortal(
    <div className="go-deeper fixed bottom-5 right-5 z-30 flex flex-col items-end gap-2">
      {open ? (
        <div className="w-72 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--sidebar)] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)]">
          <p className="border-b border-[var(--line)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
            Go Deeper threads on this page
          </p>
          <ul className="max-h-72 overflow-y-auto py-1 [scrollbar-gutter:stable]">
            {minimized.map((t) => {
              const { title, replies } = summary(t.deeper);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpen(t.id);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--sidebar-active)]"
                  >
                    <span className="mt-0.5 text-[10px] text-[var(--accent)]">✦</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-[var(--ink)]">{title}</span>
                      <span className="block truncate text-[11px] text-[var(--ink-muted)]">
                        “{t.deeper.text.slice(0, 60)}”{replies ? ` · ${replies} Q` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--accent)_40%,var(--line))] bg-[var(--sidebar)] px-3 py-2 text-xs font-medium text-[var(--ink)] shadow-lg hover:border-[var(--accent)]"
        aria-expanded={open}
        title="Minimized Go Deeper threads"
      >
        <span className="text-[var(--accent)]">✦</span>
        {minimized.length} {minimized.length === 1 ? "thread" : "threads"}
      </button>
    </div>,
    document.body,
  );
}

/** Link to a sub-page (e.g. a Go Deeper thread converted to a page). */
export function PageLinkBlock({
  title,
  missing,
  onOpen,
  onRemove,
}: {
  title: string;
  missing: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="go-deeper group my-1 flex items-center gap-2" contentEditable={false}>
      <button
        type="button"
        onClick={onOpen}
        disabled={missing}
        className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-[1.0625rem] text-[var(--ink)] hover:bg-[var(--sidebar-active)] disabled:opacity-50"
      >
        <span aria-hidden className="text-[var(--ink-muted)]">📄</span>
        <span className="truncate underline decoration-[var(--line)] underline-offset-4">{missing ? "Deleted page" : title}</span>
        <span className="shrink-0 rounded border border-[var(--line)] px-1 text-[10px] text-[var(--ink-muted)]">sub-page</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-muted)] opacity-0 hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)] group-hover:opacity-100"
        aria-label="Remove link"
      >
        Remove link
      </button>
    </div>
  );
}

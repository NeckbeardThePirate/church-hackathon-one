"use client";

import { useEffect, useRef } from "react";
import {
  matchMarkdownShortcut,
  placeholderForType,
  type BlockType,
} from "../lib/block-types";
import { detectSlashQuery, runFormatCommand } from "../lib/editor-format";

function openEditorLink(event: React.MouseEvent, anchor: HTMLAnchorElement): void {
  event.preventDefault();
  event.stopPropagation();
  const href = anchor.getAttribute("href");
  if (!href) return;
  const target = anchor.getAttribute("target") ?? "_blank";
  if (target === "_blank") {
    window.open(href, "_blank", "noopener,noreferrer");
  } else {
    window.location.assign(href);
  }
}

function handleEditorLinkPointer(event: React.MouseEvent<HTMLDivElement>): void {
  if (event.button !== 0) return;
  const anchor = (event.target as HTMLElement).closest("a");
  if (!(anchor instanceof HTMLAnchorElement) || !anchor.getAttribute("href")) return;
  openEditorLink(event, anchor);
}

function isBlockEmpty(element: HTMLElement): boolean {
  const text = element.innerText.replace(/\u200B/g, "").trim();
  if (text !== "") return false;
  const html = element.innerHTML.replace(/<br\s*\/?>/gi, "").trim();
  return html === "";
}

function caretAtStart(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  const pre = range.cloneRange();
  pre.selectNodeContents(element);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length === 0;
}

function caretAtEnd(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  const post = range.cloneRange();
  post.selectNodeContents(element);
  post.setStart(range.endContainer, range.endOffset);
  return post.toString().length === 0;
}

function placeCaretAtEnd(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

type EditorBlockProps = {
  blockId: string;
  type: BlockType;
  isFirst: boolean;
  listIndex?: number;
  initialHtml?: string;
  autoFocus?: boolean;
  onFocused?: () => void;
  onInput: (blockId: string, html: string, text: string) => void;
  onEnter: (blockId: string) => void;
  onBackspaceEmpty: (blockId: string) => void;
  onChangeType: (blockId: string, type: BlockType, html?: string) => void;
  onSlashQuery: (blockId: string, query: string | null) => void;
  onNavigate: (blockId: string, direction: "up" | "down") => void;
  onRequestFormatPersist: (blockId: string) => void;
  onGoDeeper?: (blockId: string) => void;
  onAutoFormat?: (blockId: string) => void;
  autoFormatBusy?: boolean;
  historyRevision?: number;
};

export function EditorBlock({
  blockId,
  type,
  isFirst,
  listIndex = 1,
  initialHtml = "",
  autoFocus,
  onFocused,
  onInput,
  onEnter,
  onBackspaceEmpty,
  onChangeType,
  onSlashQuery,
  onNavigate,
  onRequestFormatPersist,
  onGoDeeper,
  onAutoFormat,
  autoFormatBusy = false,
  historyRevision = 0,
}: EditorBlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  const lastHistoryRevisionRef = useRef(historyRevision);

  useEffect(() => {
    if (!ref.current || seeded.current) return;
    if (initialHtml) ref.current.innerHTML = initialHtml;
    seeded.current = true;
    ref.current.classList.toggle("is-empty", isBlockEmpty(ref.current));
    if (autoFocus) {
      ref.current.focus();
      onFocused?.();
    }
  }, [autoFocus, initialHtml, onFocused]);

  useEffect(() => {
    if (!ref.current || !seeded.current) return;
    if (autoFocus && document.activeElement !== ref.current) {
      ref.current.focus();
      onFocused?.();
    }
  }, [autoFocus, onFocused]);

  useEffect(() => {
    if (!ref.current || !seeded.current) return;
    const historyApplied = historyRevision !== lastHistoryRevisionRef.current;
    lastHistoryRevisionRef.current = historyRevision;
    if (!historyApplied && document.activeElement === ref.current) return;
    if (ref.current.innerHTML !== initialHtml) {
      ref.current.innerHTML = initialHtml;
      ref.current.classList.toggle("is-empty", isBlockEmpty(ref.current));
      if (historyApplied && document.activeElement === ref.current) {
        placeCaretAtEnd(ref.current);
      }
    }
  }, [initialHtml, historyRevision]);

  if (type === "divider") {
    return (
      <div
        className="editor-divider group relative my-3 flex items-center py-2"
        data-block-id={blockId}
      >
        <hr className="w-full border-0 border-t border-[var(--line)]" />
        <button
          type="button"
          className="absolute right-0 rounded px-1.5 py-0.5 text-xs text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)] group-hover:opacity-100"
          onClick={() => onBackspaceEmpty(blockId)}
          aria-label="Remove divider"
        >
          Remove
        </button>
      </div>
    );
  }

  const placeholder = placeholderForType(type, isFirst);

  return (
    <div className={`editor-row group/row relative flex gap-2 ${type === "quote" ? "pl-0" : ""}`} data-block-id={blockId}>
      {onAutoFormat || onGoDeeper ? (
        <div className="absolute -right-2 top-0.5 z-10 hidden translate-x-full flex-col items-stretch gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 md:flex">
          {onAutoFormat ? (
            <button
              type="button"
              contentEditable={false}
              disabled={autoFormatBusy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onAutoFormat(blockId)}
              className="whitespace-nowrap rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-2 py-0.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-60"
              title="Clean up structure for this block"
            >
              {autoFormatBusy ? "Formatting…" : "Auto Format"}
            </button>
          ) : null}
          {onGoDeeper ? (
            <button
              type="button"
              contentEditable={false}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onGoDeeper(blockId)}
              className="whitespace-nowrap rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-2 py-0.5 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
              title="Cross-references, church fathers & confessions"
            >
              Go deeper ↓
            </button>
          ) : null}
        </div>
      ) : null}
      {type === "bullet" ? (
        <span className="editor-marker mt-[0.35rem] w-5 shrink-0 select-none text-center text-[var(--ink-muted)]" aria-hidden>
          •
        </span>
      ) : null}
      {type === "numbered" ? (
        <span className="editor-marker mt-[0.35rem] w-6 shrink-0 select-none text-right text-sm tabular-nums text-[var(--ink-muted)]" aria-hidden>
          {listIndex}.
        </span>
      ) : null}
      {type === "quote" ? (
        <span className="mt-1 w-1 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_55%,var(--line))]" aria-hidden />
      ) : null}
      <div
        ref={ref}
        className={`editor-block editable-surface min-h-[1.75rem] w-full flex-1 outline-none ${blockTypeClass(type)}`}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-block-type={type}
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
        onMouseDown={handleEditorLinkPointer}
        onInput={(event) => {
          const target = event.currentTarget;
          target.classList.toggle("is-empty", isBlockEmpty(target));
          const text = target.innerText;
          onInput(blockId, target.innerHTML, text);

          const slash = detectSlashQuery(text);
          onSlashQuery(blockId, slash);
        }}
        onKeyDown={(event) => {
          const target = event.currentTarget;
          const meta = event.metaKey || event.ctrlKey;

          if (meta && event.key.toLowerCase() === "b") {
            event.preventDefault();
            runFormatCommand("bold");
            onRequestFormatPersist(blockId);
            return;
          }
          if (meta && event.key.toLowerCase() === "i") {
            event.preventDefault();
            runFormatCommand("italic");
            onRequestFormatPersist(blockId);
            return;
          }
          if (meta && event.key.toLowerCase() === "u") {
            event.preventDefault();
            runFormatCommand("underline");
            onRequestFormatPersist(blockId);
            return;
          }

          if (event.key === "ArrowUp" && caretAtStart(target)) {
            event.preventDefault();
            onNavigate(blockId, "up");
            return;
          }
          if (event.key === "ArrowDown" && caretAtEnd(target)) {
            event.preventDefault();
            onNavigate(blockId, "down");
            return;
          }

          if (event.key === " " && !meta) {
            const plain = target.innerText.replace(/\u200B/g, "").replace(/\n/g, "");
            const match = matchMarkdownShortcut(plain);
            if (match) {
              event.preventDefault();
              if (match.type === "divider") {
                onChangeType(blockId, "divider", "");
                onSlashQuery(blockId, null);
                return;
              }
              target.innerHTML = match.rest;
              target.classList.toggle("is-empty", isBlockEmpty(target));
              onChangeType(blockId, match.type, match.rest);
              onSlashQuery(blockId, null);
              return;
            }
          }

          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSlashQuery(blockId, null);
            onEnter(blockId);
            return;
          }

          if (event.key === "Backspace") {
            if (isBlockEmpty(target)) {
              event.preventDefault();
              onSlashQuery(blockId, null);
              if (type !== "paragraph") {
                onChangeType(blockId, "paragraph", "");
              } else {
                onBackspaceEmpty(blockId);
              }
              return;
            }
          }

          if (event.key === "Escape") {
            onSlashQuery(blockId, null);
          }
        }}
        onBlur={() => {
          // Delay so slash menu click can fire first.
          window.setTimeout(() => {
            if (!ref.current) return;
            if (document.activeElement?.closest(".slash-menu")) return;
            onSlashQuery(blockId, null);
          }, 120);
        }}
      />
    </div>
  );
}

function blockTypeClass(type: BlockType): string {
  switch (type) {
    case "heading1":
      return "editor-block--h1 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)]";
    case "heading2":
      return "editor-block--h2 text-[1.35rem] font-semibold leading-snug tracking-[-0.015em] text-[var(--ink)]";
    case "quote":
      return "editor-block--quote text-[1.05rem] italic leading-relaxed text-[color-mix(in_srgb,var(--ink)_88%,var(--accent))]";
    case "bullet":
    case "numbered":
      return "editor-block--list text-[1.0625rem] leading-[1.75] text-[var(--ink)]";
    default:
      return "editor-block--paragraph text-[1.0625rem] leading-[1.75] text-[var(--ink)]";
  }
}

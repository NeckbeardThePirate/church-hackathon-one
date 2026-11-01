"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getSelectionRect,
  queryFormatState,
  runFormatCommand,
  selectionHasLink,
  type SelectionRect,
} from "../lib/editor-format";

type FormatToolbarProps = {
  /** Root that owns editable blocks; toolbar only shows for selections inside it. */
  editorRoot: HTMLElement | null;
  /** Called after a format command so the parent can persist HTML. */
  onFormatted: () => void;
  onAutoFormatSelection?: () => void;
  autoFormatBusy?: boolean;
};

type FormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  link: boolean;
};

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => {
        // Keep the text selection when clicking the toolbar.
        event.preventDefault();
      }}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${
        active
          ? "bg-[var(--sidebar-active)] text-[var(--ink)]"
          : "text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
      }`}
    >
      {children}
    </button>
  );
}

export function FormatToolbar({
  editorRoot,
  onFormatted,
  onAutoFormatSelection,
  autoFormatBusy = false,
}: FormatToolbarProps) {
  const [rect, setRect] = useState<SelectionRect | null>(null);
  const [state, setState] = useState<FormatState>({
    bold: false,
    italic: false,
    underline: false,
    link: false,
  });

  const refresh = useCallback(() => {
    if (!editorRoot) {
      setRect(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setRect(null);
      return;
    }
    const anchor = selection.anchorNode;
    if (!anchor || !editorRoot.contains(anchor)) {
      setRect(null);
      return;
    }
    if (anchor instanceof Element && anchor.closest("input, textarea, .bible-callout")) {
      setRect(null);
      return;
    }
    if (anchor.parentElement?.closest("input, textarea, .bible-callout")) {
      setRect(null);
      return;
    }

    const nextRect = getSelectionRect();
    setRect(nextRect);
    if (nextRect) {
      setState({
        bold: queryFormatState("bold"),
        italic: queryFormatState("italic"),
        underline: queryFormatState("underline"),
        link: selectionHasLink(),
      });
    }
  }, [editorRoot]);

  useEffect(() => {
    const handle = () => refresh();
    document.addEventListener("selectionchange", handle);
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      document.removeEventListener("selectionchange", handle);
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [refresh]);

  const apply = useCallback(
    (command: "bold" | "italic" | "underline") => {
      runFormatCommand(command);
      onFormatted();
      refresh();
    },
    [onFormatted, refresh],
  );

  const toggleLink = useCallback(() => {
    if (selectionHasLink()) {
      runFormatCommand("unlink");
    } else {
      const url = window.prompt("Link URL", "https://");
      if (!url) return;
      runFormatCommand("createLink", url);
    }
    onFormatted();
    refresh();
  }, [onFormatted, refresh]);

  if (!rect || !editorRoot) return null;

  const rootRect = editorRoot.getBoundingClientRect();
  const top = rect.top - rootRect.top - 48;
  const left = rect.left - rootRect.left + rect.width / 2 - (onAutoFormatSelection ? 148 : 100);

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="format-toolbar pointer-events-auto absolute z-40 flex items-center gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--sidebar)] p-1 shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
      style={{ top: Math.max(-8, top), left: Math.max(0, left) }}
    >
      <ToolbarButton label="Bold" active={state.bold} onClick={() => apply("bold")}>
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton label="Italic" active={state.italic} onClick={() => apply("italic")}>
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton label="Underline" active={state.underline} onClick={() => apply("underline")}>
        <span className="underline">U</span>
      </ToolbarButton>
      <span className="mx-0.5 h-5 w-px bg-[var(--line)]" aria-hidden />
      <ToolbarButton label={state.link ? "Remove link" : "Add link"} active={state.link} onClick={toggleLink}>
        <span className="text-xs font-medium">Link</span>
      </ToolbarButton>
      {onAutoFormatSelection ? (
        <>
          <span className="mx-0.5 h-5 w-px bg-[var(--line)]" aria-hidden />
          <ToolbarButton
            label={autoFormatBusy ? "Formatting selection…" : "Auto Format selection"}
            disabled={autoFormatBusy}
            onClick={onAutoFormatSelection}
          >
            <span className="whitespace-nowrap text-xs font-medium">
              {autoFormatBusy ? "…" : "Auto Format"}
            </span>
          </ToolbarButton>
        </>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { filterSlashCommands, type BlockType, type SlashCommand } from "../lib/block-types";

const MENU_WIDTH = 300;
const MENU_MAX_HEIGHT = 288;
const GAP = 6;
const VIEWPORT_PAD = 8;

type SlashMenuProps = {
  query: string;
  blockId: string;
  /** Editor root that contains `[data-block-id]`. */
  editorRoot: HTMLElement;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onPick: (type: BlockType) => void;
  onClose: () => void;
};

type MenuCoords = {
  top: number;
  left: number;
  maxHeight: number;
  openAbove: boolean;
};

function measureAnchorRect(editorRoot: HTMLElement, blockId: string): DOMRect | null {
  const row = editorRoot.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
  if (!(row instanceof HTMLElement)) return null;

  const editable =
    row.querySelector<HTMLElement>('[contenteditable="true"]') ??
    (row.matches('[contenteditable="true"]') ? row : null);

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && editable) {
    const node = selection.anchorNode;
    if (node && editable.contains(node)) {
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(true);
      const caret = range.getBoundingClientRect();
      if (caret.width > 0 || caret.height > 0) return caret;
    }
  }

  const target = editable ?? row;
  const rect = target.getBoundingClientRect();
  // Use the first line of the block so a tall block does not push the menu to the bottom.
  return new DOMRect(rect.left, rect.top, Math.max(rect.width, 1), Math.min(rect.height || 24, 28));
}

function computeCoords(anchor: DOMRect, estimatedHeight: number): MenuCoords {
  const maxHeight = Math.min(MENU_MAX_HEIGHT, Math.max(120, estimatedHeight));
  const spaceBelow = window.innerHeight - anchor.bottom - VIEWPORT_PAD;
  const spaceAbove = anchor.top - VIEWPORT_PAD;
  const openAbove = spaceBelow < maxHeight + GAP && spaceAbove > spaceBelow;

  const available = openAbove ? spaceAbove - GAP : spaceBelow - GAP;
  const clampedMaxHeight = Math.max(96, Math.min(maxHeight, available));

  const top = openAbove
    ? Math.max(VIEWPORT_PAD, anchor.top - clampedMaxHeight - GAP)
    : Math.min(window.innerHeight - VIEWPORT_PAD - clampedMaxHeight, anchor.bottom + GAP);

  const left = Math.min(
    window.innerWidth - MENU_WIDTH - VIEWPORT_PAD,
    Math.max(VIEWPORT_PAD, anchor.left),
  );

  return { top, left, maxHeight: clampedMaxHeight, openAbove };
}

export function SlashMenu({
  query,
  blockId,
  editorRoot,
  selectedIndex,
  onSelectedIndexChange,
  onPick,
  onClose,
}: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const commands = filterSlashCommands(query);
  const estimatedHeight = commands.length === 0 ? 52 : Math.min(MENU_MAX_HEIGHT, 36 + commands.length * 52);
  const [coords, setCoords] = useState<MenuCoords>(() => {
    const anchor = measureAnchorRect(editorRoot, blockId);
    return anchor
      ? computeCoords(anchor, estimatedHeight)
      : { top: VIEWPORT_PAD, left: VIEWPORT_PAD, maxHeight: MENU_MAX_HEIGHT, openAbove: false };
  });

  const reposition = () => {
    const anchor = measureAnchorRect(editorRoot, blockId);
    if (!anchor) {
      onClose();
      return;
    }
    setCoords(computeCoords(anchor, estimatedHeight));
  };

  useLayoutEffect(() => {
    reposition();
    // Re-measure after paint in case fonts/layout shifted the caret.
    const raf = window.requestAnimationFrame(reposition);
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reposition reads latest props
  }, [blockId, editorRoot, query, estimatedHeight]);

  useEffect(() => {
    const onScrollOrResize = () => reposition();
    window.addEventListener("resize", onScrollOrResize);
    // Capture scroll from any scrollable ancestor (sidebar layouts, etc.).
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, editorRoot, estimatedHeight]);

  useEffect(() => {
    if (selectedIndex >= commands.length) {
      onSelectedIndexChange(Math.max(0, commands.length - 1));
    }
  }, [commands.length, onSelectedIndexChange, selectedIndex]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (!el) return;
    // Scroll only inside the menu — never the page (scrollIntoView was jumping the menu).
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    if (elTop < list.scrollTop) {
      list.scrollTop = elTop;
    } else if (elBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = elBottom - list.clientHeight;
    }
  }, [selectedIndex]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!listRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onClose]);

  const style: React.CSSProperties = {
    position: "fixed",
    top: coords.top,
    left: coords.left,
    width: MENU_WIDTH,
    maxHeight: coords.maxHeight,
    zIndex: 60,
  };

  if (commands.length === 0) {
    return (
      <div
        className="slash-menu overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--sidebar)] p-3 text-sm text-[var(--ink-muted)] shadow-[0_12px_40px_rgba(0,0,0,0.4)]"
        style={style}
      >
        No matching blocks
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Insert block"
      className="slash-menu overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--sidebar)] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.4)] [scrollbar-gutter:stable]"
      style={style}
    >
      <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        Basic blocks
      </p>
      {commands.map((command, index) => (
        <SlashRow
          key={command.id}
          command={command}
          index={index}
          selected={index === selectedIndex}
          onHover={() => onSelectedIndexChange(index)}
          onPick={() => onPick(command.id)}
        />
      ))}
    </div>
  );
}

function SlashRow({
  command,
  index,
  selected,
  onHover,
  onPick,
}: {
  command: SlashCommand;
  index: number;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-index={index}
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
      className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
        selected ? "bg-[var(--sidebar-active)]" : "hover:bg-[var(--sidebar-active)]"
      }`}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--canvas)] text-xs font-semibold text-[var(--ink)]">
        {command.glyph}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--ink)]">{command.label}</span>
        <span className="block truncate text-xs text-[var(--ink-muted)]">{command.description}</span>
      </span>
    </button>
  );
}

export function getSlashCommandAt(query: string, index: number): SlashCommand | null {
  const commands = filterSlashCommands(query);
  return commands[index] ?? null;
}

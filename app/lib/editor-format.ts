/** Lightweight helpers for contentEditable inline formatting. */

export type FormatCommand = "bold" | "italic" | "underline" | "createLink" | "unlink";

export function runFormatCommand(command: FormatCommand, value?: string): boolean {
  try {
    if (command === "createLink") {
      const url = value?.trim();
      if (!url) return false;
      return document.execCommand("createLink", false, url);
    }
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

export function queryFormatState(command: "bold" | "italic" | "underline"): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

export function selectionHasLink(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  let node: Node | null = selection.anchorNode;
  while (node && node !== document.body) {
    if (node instanceof HTMLAnchorElement) return true;
    if (node instanceof Element && node.closest("a")) return true;
    node = node.parentNode;
  }
  return false;
}

export type SelectionRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function getSelectionRect(): SelectionRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function selectionIsInside(element: HTMLElement | null): boolean {
  if (!element) return false;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const node = selection.anchorNode;
  if (!node) return false;
  return element.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node);
}

/** Detect a Notion-style slash query at the start of the block. */
export function detectSlashQuery(plainText: string): string | null {
  const text = plainText.replace(/\u200B/g, "").replace(/\n/g, "");
  if (!text.startsWith("/")) return null;
  const body = text.slice(1);
  if (body.includes(" ")) return null;
  return body;
}

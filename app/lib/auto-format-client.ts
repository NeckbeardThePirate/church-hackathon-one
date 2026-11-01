import {
  splitTextForAutoFormat,
  type AutoFormatBlock,
  type AutoFormatScope,
} from "./auto-format-shared";
import { createBlock, isNonTextBlock, type BlockContent } from "./projects";

export type { AutoFormatBlock, AutoFormatScope };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\u200B/g, "")
    .trim();
}

export function autoFormatBlocksToEditorBlocks(blocks: AutoFormatBlock[]): BlockContent[] {
  if (blocks.length === 0) return [createBlock()];
  return blocks.map((block) => {
    if (block.type === "divider") return createBlock("divider", "");
    return createBlock(block.type, escapeHtml(block.text));
  });
}

export function serializeBlocksForFormat(blocks: BlockContent[]): string {
  return blocks
    .filter((block) => !isNonTextBlock(block) && block.type !== "divider")
    .map((block) => {
      const plain = stripHtmlToPlain(block.html);
      if (!plain) return "";
      if (block.type === "heading1") return `# ${plain}`;
      if (block.type === "heading2") return `## ${plain}`;
      if (block.type === "bullet") return `- ${plain}`;
      if (block.type === "numbered") return `1. ${plain}`;
      if (block.type === "quote") return `> ${plain}`;
      return plain;
    })
    .filter(Boolean)
    .join("\n\n");
}

export type SelectionFormatTarget = {
  text: string;
  /** Inclusive index range in the blocks array to replace. */
  startIndex: number;
  endIndex: number;
};

export function resolveSelectionFormatTarget(
  editorRoot: HTMLElement,
  blocks: BlockContent[],
): SelectionFormatTarget | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const text = selection.toString().replace(/\u200B/g, "").trim();
  if (!text) return null;

  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!anchor || !focus) return null;
  if (!editorRoot.contains(anchor) || !editorRoot.contains(focus)) return null;

  const startEl = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest("[data-block-id]");
  const endEl = (focus instanceof Element ? focus : focus.parentElement)?.closest("[data-block-id]");
  if (!(startEl instanceof HTMLElement) || !(endEl instanceof HTMLElement)) return null;

  const startId = startEl.getAttribute("data-block-id");
  const endId = endEl.getAttribute("data-block-id");
  if (!startId || !endId) return null;

  const startIndex = blocks.findIndex((block) => block.id === startId);
  const endIndex = blocks.findIndex((block) => block.id === endId);
  if (startIndex === -1 || endIndex === -1) return null;

  return {
    text,
    startIndex: Math.min(startIndex, endIndex),
    endIndex: Math.max(startIndex, endIndex),
  };
}

async function readJsonPayload(response: Response): Promise<{ blocks?: AutoFormatBlock[]; error?: string }> {
  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error(
      response.ok
        ? "Auto format returned an empty response. Try again."
        : `Auto format failed (HTTP ${response.status}) with an empty response. Try a smaller selection, or sign in again.`,
    );
  }
  try {
    return JSON.parse(raw) as { blocks?: AutoFormatBlock[]; error?: string };
  } catch {
    throw new Error(
      `Auto format returned invalid JSON (HTTP ${response.status}). ${raw.slice(0, 180)}`,
    );
  }
}

async function requestAutoFormatChunk(options: {
  text: string;
  scope: AutoFormatScope;
  noteKind?: string;
}): Promise<AutoFormatBlock[]> {
  const response = await fetch("/api/notes/auto-format", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: options.text,
      scope: options.scope,
      noteKind: options.noteKind,
    }),
  });

  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payload.error || `Auto format failed (HTTP ${response.status})`);
  }
  if (!payload.blocks?.length) {
    throw new Error(payload.error || "Auto format returned no blocks");
  }
  return payload.blocks;
}

export async function requestAutoFormat(options: {
  text: string;
  scope: AutoFormatScope;
  noteKind?: string;
}): Promise<AutoFormatBlock[]> {
  const chunks = splitTextForAutoFormat(options.text);
  if (chunks.length === 0) {
    throw new Error("Nothing to format.");
  }

  // Long notes: one HTTP request per chunk so a timeout/crash still returns a useful error
  // instead of an empty body from a multi-minute server loop.
  if (chunks.length === 1) {
    return requestAutoFormatChunk({
      text: chunks[0]!,
      scope: options.scope,
      noteKind: options.noteKind,
    });
  }

  const merged: AutoFormatBlock[] = [];
  for (const chunk of chunks) {
    const blocks = await requestAutoFormatChunk({
      text: chunk,
      scope: options.scope === "selection" ? "selection" : "document",
      noteKind: options.noteKind,
    });
    merged.push(...blocks);
  }
  return merged;
}

/** Replace a contiguous slice of blocks, preserving bible callouts outside the slice. */
export function replaceBlockRange(
  blocks: BlockContent[],
  startIndex: number,
  endIndex: number,
  next: BlockContent[],
): BlockContent[] {
  const before = blocks.slice(0, startIndex);
  const after = blocks.slice(endIndex + 1);
  const merged = [...before, ...next, ...after];
  return merged.length ? merged : [createBlock()];
}

export function replaceDocumentContent(blocks: BlockContent[], next: BlockContent[]): BlockContent[] {
  const callouts = blocks.filter((block) => isNonTextBlock(block));
  if (callouts.length === 0) return next.length ? next : [createBlock()];
  // Keep callouts, deeper threads and page links after the reformatted note.
  return [...(next.length ? next : [createBlock()]), ...callouts];
}

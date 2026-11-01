import { createBlock, type BlockContent } from "./projects";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function plainTextToBlocks(text: string): BlockContent[] {
  const normalized = text.replace(/\r\n/g, "\n").trimEnd();
  if (!normalized.trim()) return [createBlock()];

  const lines = normalized.split("\n");
  return lines.map((line) => createBlock("paragraph", escapeHtml(line)));
}

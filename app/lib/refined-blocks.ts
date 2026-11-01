import type { BlockType } from "./block-types";
import { createBlock, type BlockContent } from "./projects";
import type { RefinedBlock } from "./server/refine-ocr";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function roleToType(role: RefinedBlock["role"]): BlockType {
  if (role === "heading") return "heading1";
  if (role === "bullet") return "bullet";
  return "paragraph";
}

export function refinedBlocksToEditorBlocks(blocks: RefinedBlock[]): BlockContent[] {
  if (blocks.length === 0) return [createBlock()];

  return blocks.map((block) => {
    const safe = escapeHtml(block.text);
    return createBlock(roleToType(block.role), safe);
  });
}

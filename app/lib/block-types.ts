export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "bullet"
  | "numbered"
  | "quote"
  | "divider";

const BLOCK_TYPES: BlockType[] = [
  "paragraph",
  "heading1",
  "heading2",
  "bullet",
  "numbered",
  "quote",
  "divider",
];

function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && (BLOCK_TYPES as string[]).includes(value);
}

export function normalizeBlockType(value: unknown): BlockType {
  return isBlockType(value) ? value : "paragraph";
}

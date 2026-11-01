import type { BlockType } from "./block-types";

export type AutoFormatScope = "document" | "block" | "selection";

export type AutoFormatBlock = {
  type: BlockType;
  text: string;
};

/** Keep each request small enough for the model to finish valid JSON. */
export const AUTO_FORMAT_MAX_INPUT_CHARS = 5500;
export const AUTO_FORMAT_CHUNK_CHARS = 4000;

/** Split on blank lines so each API call stays under the model budget. */
export function splitTextForAutoFormat(text: string, maxChars = AUTO_FORMAT_CHUNK_CHARS): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const parts = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    if (!current) {
      if (piece.length > maxChars) {
        for (let i = 0; i < piece.length; i += maxChars) {
          chunks.push(piece.slice(i, i + maxChars));
        }
      } else {
        current = piece;
      }
      continue;
    }
    if (current.length + 2 + piece.length <= maxChars) {
      current = `${current}\n\n${piece}`;
    } else {
      push();
      if (piece.length > maxChars) {
        for (let i = 0; i < piece.length; i += maxChars) {
          chunks.push(piece.slice(i, i + maxChars));
        }
      } else {
        current = piece;
      }
    }
  }
  push();
  return chunks.length ? chunks : [normalized.slice(0, maxChars)];
}

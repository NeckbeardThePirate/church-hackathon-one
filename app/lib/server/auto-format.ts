import {
  AUTO_FORMAT_MAX_INPUT_CHARS,
  type AutoFormatBlock,
  type AutoFormatScope,
} from "../auto-format-shared";
import { isBlockType, type BlockType } from "../block-types";
import { parseWorkersAiText } from "./ocr";
import { REFINE_MODEL } from "./refine-ocr";

export type { AutoFormatBlock, AutoFormatScope };

export type AutoFormatResult = {
  blocks: AutoFormatBlock[];
};

const MAX_OUTPUT_TOKENS = 4096;

const SYSTEM = `You clean up and structure church study notes (lessons, Bible study, learning notes).
Given messy or flat text, return well-structured note blocks.
Rules:
- Preserve meaning, scripture references, and wording as closely as practical. Do not invent theology or new content.
- Prefer clear headings, short paragraphs, bullets, numbered lists, and quotes for verses or citations.
- Use type "heading1" for main titles/sections, "heading2" for subsections.
- Use "bullet" for unordered lists, "numbered" for steps/ordered lists, "quote" for scripture or quoted material, "paragraph" for body text, "divider" sparingly between major sections.
- Each block is one heading, one paragraph, one list item, one quote, or a divider (empty text).
- Keep each "text" value short (one line or a short paragraph). Prefer more blocks over long strings.
- Strip OCR artifacts, repeated spaces, and broken line wraps. Keep verse references intact (e.g. "James 2:14-17").
- Return a COMPLETE JSON object. Do not truncate mid-string.
Return ONLY valid JSON:
{"blocks":[{"type":"paragraph"|"heading1"|"heading2"|"bullet"|"numbered"|"quote"|"divider","text":"..."}]}
No markdown fences or commentary.`;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeType(value: unknown): BlockType {
  if (isBlockType(value)) return value;
  if (value === "heading" || value === "h1") return "heading1";
  if (value === "h2") return "heading2";
  if (value === "ul" || value === "list") return "bullet";
  if (value === "ol") return "numbered";
  if (value === "blockquote") return "quote";
  if (value === "hr") return "divider";
  return "paragraph";
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function blockFromUnknown(item: unknown): AutoFormatBlock | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const type = normalizeType(record.type);
  const text = str(record.text);
  if (type === "divider") return { type, text: "" };
  if (!text) return null;
  return { type, text };
}

/** Walk a truncated `{"blocks":[...` payload and keep only complete objects. */
function salvageBlocksFromPartialJson(raw: string): AutoFormatBlock[] {
  const text = stripFences(raw);
  const marker = text.indexOf('"blocks"');
  if (marker === -1) return [];
  const arrayStart = text.indexOf("[", marker);
  if (arrayStart === -1) return [];

  const blocks: AutoFormatBlock[] = [];
  let i = arrayStart + 1;

  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i]!)) i += 1;
    if (i >= text.length || text[i] === "]") break;
    if (text[i] !== "{") break;

    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    let closed = false;

    for (; i < text.length; i += 1) {
      const ch = text[i]!;
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          closed = true;
          break;
        }
      }
    }

    if (!closed) break;

    try {
      const parsed = JSON.parse(text.slice(start, i)) as unknown;
      const block = blockFromUnknown(parsed);
      if (block) blocks.push(block);
    } catch {
      // Skip malformed object and stop — later content is unreliable.
      break;
    }
  }

  return blocks;
}

function closeOpenJson(raw: string): string {
  let s = stripFences(raw);
  const start = s.indexOf("{");
  if (start === -1) return s;
  s = s.slice(start);

  // If truncated inside a string, close it.
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
  }
  if (inString) s += '"';

  // Drop a trailing incomplete key/value fragment after the last complete object.
  // Then close open braces/brackets.
  const stack: string[] = [];
  inString = false;
  escape = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    if (ch === "}" || ch === "]") stack.pop();
  }

  // Remove dangling comma before we close.
  s = s.replace(/,\s*$/, "");
  while (stack.length) s += stack.pop();
  return s;
}

export function parseAutoFormatJson(raw: string): AutoFormatResult {
  const cleaned = stripFences(raw);

  const attempts = [cleaned, closeOpenJson(cleaned)];
  for (const attempt of attempts) {
    try {
      const start = attempt.indexOf("{");
      const end = attempt.lastIndexOf("}");
      const jsonText =
        start >= 0 && end > start ? attempt.slice(start, end + 1) : attempt;
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const items = Array.isArray(parsed.blocks) ? parsed.blocks : [];
      const blocks = items
        .map((item) => blockFromUnknown(item))
        .filter((block): block is AutoFormatBlock => !!block);
      if (blocks.length > 0) return { blocks };
    } catch {
      // Try salvage / next attempt.
    }
  }

  const salvaged = salvageBlocksFromPartialJson(cleaned);
  if (salvaged.length > 0) return { blocks: salvaged };

  throw new Error(
    "Auto format returned incomplete JSON (response was likely cut off). Try a smaller selection, or run Auto Format again.",
  );
}

export async function runAutoFormat(
  ai: Ai,
  text: string,
  scope: AutoFormatScope,
  noteKind?: string,
): Promise<AutoFormatResult> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length < 1) {
    throw new Error("Nothing to format.");
  }

  // Client chunks long notes; each request stays single-shot so timeouts return JSON.
  const clipped = normalized.slice(0, AUTO_FORMAT_MAX_INPUT_CHARS);
  const kind = noteKind?.trim() || "study";

  const scopeHint =
    scope === "document"
      ? "Format this note section."
      : scope === "block"
        ? "Format this single block; it may become multiple blocks."
        : "Format only the selected excerpt; it may become multiple blocks.";

  const result = await ai.run(REFINE_MODEL, {
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Note type: ${kind}
Scope: ${scope}. ${scopeHint}

Text:
"""
${clipped}
"""`,
      },
    ],
    response_format: { type: "json_object" },
    reasoning_effort: "low",
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
  } as never);

  const responseText = parseWorkersAiText(result);
  if (!responseText) throw new Error("Model returned no text.");
  return parseAutoFormatJson(responseText);
}

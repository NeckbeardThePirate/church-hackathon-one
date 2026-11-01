import { bytesToDataUri, parseWorkersAiText } from "./ocr";

export const REFINE_MODEL = "@cf/zai-org/glm-5.3-flash";

export type RefinedBlockRole = "heading" | "paragraph" | "bullet";

export type RefinedBlock = {
  role: RefinedBlockRole;
  text: string;
};

export type RefineOcrResult = {
  title?: string;
  blocks: RefinedBlock[];
  plainText: string;
};

const REFINE_SYSTEM = `You improve OCR output for church notes (lessons, study, learning).
Compare the source image to the raw OCR text. Fix misread words, missing lines, and broken formatting.
Do not invent content that is not supported by the image or OCR. Preserve meaning and scripture references accurately.
Return ONLY valid JSON with this shape:
{"title":"optional short title","blocks":[{"role":"heading"|"paragraph"|"bullet","text":"..."}]}
No markdown fences or commentary.`;

function buildRefineUserText(rawOcrText: string, noteKind: string): string {
  return `Note type: ${noteKind}

Raw OCR (may contain errors):

"""
${rawOcrText.trim()}
"""

Task:
1. Use the image as ground truth where it disagrees with OCR.
2. Produce a clean, structured note with headings, paragraphs, and bullet lists where appropriate.
3. Each block is one line or one bullet item; split long sections into multiple paragraph blocks.`;
}

export function parseRefineJson(raw: string): RefineOcrResult {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);

  const parsed = JSON.parse(jsonText) as {
    title?: string;
    blocks?: { role?: string; text?: string }[];
  };

  const blocks: RefinedBlock[] = [];
  for (const item of parsed.blocks ?? []) {
    const text = (item.text ?? "").trim();
    if (!text) continue;
    const role = item.role === "heading" || item.role === "bullet" ? item.role : "paragraph";
    blocks.push({ role, text });
  }

  if (blocks.length === 0) {
    throw new Error("Refinement returned no content blocks.");
  }

  const title = typeof parsed.title === "string" ? parsed.title.trim() : undefined;
  const plainText = blocks
    .map((block) => {
      if (block.role === "heading") return block.text.toUpperCase() === block.text ? block.text : block.text;
      if (block.role === "bullet") return `• ${block.text}`;
      return block.text;
    })
    .join("\n\n");

  return { title, blocks, plainText };
}

export async function runRefineOcrFromBytes(
  ai: Ai,
  bytes: Uint8Array,
  contentType: string,
  rawOcrText: string,
  noteKind: string,
): Promise<RefineOcrResult> {
  const imageDataUri = bytesToDataUri(bytes, contentType);
  const result = await ai.run(REFINE_MODEL, {
    messages: [
      { role: "system", content: REFINE_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: buildRefineUserText(rawOcrText, noteKind) },
          { type: "image_url", image_url: { url: imageDataUri } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    reasoning_effort: "low",
    max_tokens: 4096,
    temperature: 0.2,
  });

  const responseText = parseWorkersAiText(result);
  if (!responseText) {
    throw new Error("Refinement model returned no text.");
  }

  return parseRefineJson(responseText);
}

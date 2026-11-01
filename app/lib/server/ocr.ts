export const OCR_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

const OCR_SYSTEM =
  "You perform OCR. Return only the text visible in the image, preserving line breaks. No commentary.";

const OCR_USER = "Extract every word of visible text exactly as written.";

export function bytesToDataUri(bytes: Uint8Array, contentType: string): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    for (let i = 0; i < chunk.length; i++) {
      binary += String.fromCharCode(chunk[i]!);
    }
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

export function parseWorkersAiText(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";

  const record = result as Record<string, unknown>;

  if (typeof record.response === "string") return record.response.trim();

  const choices = record.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const message = (choices[0] as Record<string, unknown>).message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") return content.trim();
      if (Array.isArray(content)) {
        const text = content
          .map((part) => {
            if (!part || typeof part !== "object") return "";
            const piece = part as Record<string, unknown>;
            return typeof piece.text === "string" ? piece.text : "";
          })
          .join("")
          .trim();
        if (text) return text;
      }
    }
  }

  if (typeof record.answer === "string") return record.answer.trim();
  if (typeof record.caption === "string") return record.caption.trim();
  if (typeof record.text === "string") return record.text.trim();
  if (typeof record.result === "string") return record.result.trim();

  if (record.result && typeof record.result === "object") {
    return parseWorkersAiText(record.result);
  }

  return "";
}

export async function runImageOcr(ai: Ai, imageDataUri: string): Promise<string> {
  const result = await ai.run(OCR_MODEL, {
    messages: [
      { role: "system", content: OCR_SYSTEM },
      { role: "user", content: OCR_USER },
    ],
    image: imageDataUri,
  });

  const text = parseWorkersAiText(result);
  if (!text) {
    throw new Error("OCR model returned no text. Try a clearer photo or type manually.");
  }

  return text;
}

export async function runImageOcrFromBytes(ai: Ai, bytes: Uint8Array, contentType: string): Promise<string> {
  return runImageOcr(ai, bytesToDataUri(bytes, contentType));
}

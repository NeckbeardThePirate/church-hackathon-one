import type { SourceImage } from "./projects";

export const MAX_IMPORT_IMAGES = 10;

export type UploadImageResult = {
  key: string;
  contentType: string;
  fileName?: string;
  imageUrl: string;
};

export type OcrResult = {
  extractedText?: string;
  ocrError?: string;
  empty?: boolean;
};

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 130_000);
  try {
    const response = await fetch(input, { credentials: "include", ...init, signal: controller.signal });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Request failed");
    }
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Try again or type text manually.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadSourceImage(projectId: string, file: File): Promise<UploadImageResult> {
  const body = new FormData();
  body.append("file", file);
  return fetchJson<UploadImageResult>(`/api/projects/${projectId}/source-image`, {
    method: "POST",
    body,
  });
}

export async function runOcrForKey(projectId: string, key: string): Promise<OcrResult> {
  return fetchJson<OcrResult>(`/api/projects/${projectId}/source-image/ocr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
}

export function mergeStructuredText(existing: string, chunk: string, fileName: string): string {
  const trimmed = chunk.trim();
  if (!trimmed) return existing;
  const header = fileName ? `[${fileName}]` : "";
  const block = header ? `${header}\n${trimmed}` : trimmed;
  return existing.trim() ? `${existing.trim()}\n\n---\n\n${block}` : block;
}

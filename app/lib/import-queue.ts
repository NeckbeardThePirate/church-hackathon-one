import type { ProjectKind, SourceImage } from "./projects";
import type { RefinedBlock } from "./server/refine-ocr";

export const MAX_IMPORT_IMAGES = 10;

export type ImportStep = "pending" | "uploading" | "ocr" | "refine" | "done" | "error";

export type ImportQueueItem = {
  id: string;
  fileName: string;
  status: ImportStep;
  sourceImage?: SourceImage;
  imageUrl?: string;
  rawOcrText?: string;
  structuredText?: string;
  refinedBlocks?: RefinedBlock[];
  suggestedTitle?: string;
  error?: string;
};

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

export type RefineResult = {
  title?: string;
  blocks?: RefinedBlock[];
  plainText?: string;
  refineError?: string;
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

export async function runRefineForKey(
  projectId: string,
  key: string,
  rawOcrText: string,
  kind: ProjectKind,
): Promise<RefineResult> {
  return fetchJson<RefineResult>(`/api/projects/${projectId}/source-image/refine`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, rawOcrText, kind }),
  });
}

export function mergeStructuredText(existing: string, chunk: string, fileName: string): string {
  const trimmed = chunk.trim();
  if (!trimmed) return existing;
  const header = fileName ? `[${fileName}]` : "";
  const block = header ? `${header}\n${trimmed}` : trimmed;
  return existing.trim() ? `${existing.trim()}\n\n---\n\n${block}` : block;
}

export function mergeRefinedBlocks(existing: RefinedBlock[], chunk: RefinedBlock[], fileName: string): RefinedBlock[] {
  if (chunk.length === 0) return existing;
  const separator: RefinedBlock[] = existing.length
    ? [{ role: "heading", text: fileName || "Next image" }]
    : [];
  return [...existing, ...separator, ...chunk];
}

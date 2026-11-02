"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_IMPORT_IMAGES,
  mergeStructuredText,
  runOcrForKey,
  runRefineForKey,
  uploadSourceImage,
  type ImportQueueItem,
  type ImportStep,
} from "../lib/import-queue";
import { createBlock, PROJECT_KIND_LABEL, type BlockContent, type ProjectKind, type SourceImage } from "../lib/projects";
import { refinedBlocksToEditorBlocks } from "../lib/refined-blocks";
import { plainTextToBlocks } from "../lib/text-blocks";
import { RichBlockEditor } from "./RichBlockEditor";
import type { RefinedBlock } from "../lib/server/refine-ocr";

const UPLOAD_WAIT_MESSAGES = [
  "Carrying your image toward the cloud, chariot-free…",
  "Storing this scroll in a very modern ark…",
  "Uploading — patience of Job, speed of fiber.",
] as const;

const OCR_WAIT_MESSAGES = [
  "Teaching these pixels to spell…",
  "Asking if anyone can read the handwriting on the wall…",
  "The still, small voice of very small type…",
  "Daniel could read the writing — we're doing our best…",
  "Counting letters so none shall be lost…",
  "Translating photo to text, lo-fi to Logos…",
  "Be still, and know that I am… OCR-ing.",
] as const;

const REFINE_WAIT_MESSAGES = [
  "Iron sharpening iron — line break sharpening line break…",
  "Let there be headings, and there were headings…",
  "Turning fragments into something Ephesians 2:21 would respect…",
  "Comma, unto others, as you would have them comma unto you…",
  "Still structuring. So was the tabernacle.",
  "Gathering the loaves of text into baskets of meaning…",
  "Editing with love — and mild proofreading panic…",
  "Making straight paths for your note…",
] as const;

function useRotatingWaitMessage(active: boolean, messages: readonly string[], intervalMs = 2800): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    setIndex(Math.floor(Math.random() * messages.length));
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % messages.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [active, messages, intervalMs]);

  return messages[index] ?? messages[0] ?? "";
}

function stepLabel(step: ImportStep): string {
  switch (step) {
    case "pending":
      return "Queued";
    case "uploading":
      return "Uploading";
    case "ocr":
      return "OCR";
    case "refine":
      return "Structuring";
    case "done":
      return "Done";
    case "error":
      return "Error";
    default:
      return step;
  }
}

type ImageImportStepProps = {
  projectId: string;
  kind: ProjectKind;
  onComplete: (payload: {
    ocrText: string;
    rawOcrText?: string;
    sourceImages: SourceImage[];
    blocks: BlockContent[];
    suggestedTitle?: string;
  }) => void;
  onSkip: () => void;
};

export function ImageImportStep({ projectId, kind, onComplete, onSkip }: ImageImportStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileMapRef = useRef(new Map<string, File>());
  const processingRef = useRef(false);

  const [queue, setQueue] = useState<ImportQueueItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<ImportStep | null>(null);
  const [verifiedText, setVerifiedText] = useState("");
  const [rawOcrCombined, setRawOcrCombined] = useState("");
  const [editorBlocks, setEditorBlocks] = useState<BlockContent[]>([]);
  const placeholderBlocks = useMemo(() => [createBlock()], []);
  const [suggestedTitle, setSuggestedTitle] = useState<string | undefined>();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enqueueFiles = useCallback(
    (incoming: FileList | File[]) => {
      const files = [...incoming].filter((file) => file.type.startsWith("image/"));
      if (files.length === 0) return;

      setError(null);
      setQueue((prev) => {
        const room = MAX_IMPORT_IMAGES - prev.length;
        if (room <= 0) {
          setError(`You can import up to ${MAX_IMPORT_IMAGES} images at a time.`);
          return prev;
        }
        const slice = files.slice(0, room);
        if (files.length > room) {
          setError(`Only ${room} more image${room === 1 ? "" : "s"} added (${MAX_IMPORT_IMAGES} max).`);
        }
        const next = [...prev];
        for (const file of slice) {
          const id = crypto.randomUUID();
          fileMapRef.current.set(id, file);
          next.push({ id, fileName: file.name, status: "pending" });
        }
        return next;
      });
    },
    [],
  );

  const updateItem = useCallback((id: string, patch: Partial<ImportQueueItem>) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  useEffect(() => {
    const pending = queue.find((item) => item.status === "pending");
    if (!pending || processingRef.current) return;

    const file = fileMapRef.current.get(pending.id);
    if (!file) {
      updateItem(pending.id, { status: "error", error: "Missing file data" });
      return;
    }

    processingRef.current = true;
    setActiveId(pending.id);
    setStatusMessage(null);

    void (async () => {
      try {
        setActiveStep("uploading");
        updateItem(pending.id, { status: "uploading" });
        const uploaded = await uploadSourceImage(projectId, file);
        fileMapRef.current.delete(pending.id);

        const sourceImage: SourceImage = {
          key: uploaded.key,
          contentType: uploaded.contentType,
          fileName: uploaded.fileName ?? pending.fileName,
        };

        updateItem(pending.id, {
          status: "ocr",
          sourceImage,
          imageUrl: uploaded.imageUrl,
        });
        setActiveStep("ocr");

        const ocr = await runOcrForKey(projectId, uploaded.key);
        if (ocr.ocrError) {
          updateItem(pending.id, { status: "error", error: ocr.ocrError });
          setStatusMessage(ocr.ocrError);
          return;
        }

        const raw = ocr.extractedText ?? "";
        updateItem(pending.id, { rawOcrText: raw });
        setRawOcrCombined((prev) => mergeStructuredText(prev, raw, pending.fileName));

        if (ocr.empty || !raw.trim()) {
          updateItem(pending.id, { status: "done", structuredText: "" });
          setStatusMessage(`No text detected in ${pending.fileName}.`);
          return;
        }

        setActiveStep("refine");
        updateItem(pending.id, { status: "refine" });
        const refined = await runRefineForKey(projectId, uploaded.key, raw, kind);

        let structured = raw;
        let blocks: RefinedBlock[] = [];
        if (refined.refineError) {
          setStatusMessage(`Image ${pending.fileName}: structuring fell back to raw OCR.`);
        } else {
          structured = refined.plainText ?? raw;
          blocks = refined.blocks ?? [];
          if (refined.title?.trim()) {
            setSuggestedTitle((prev) => prev ?? refined.title!.trim());
          }
        }

        updateItem(pending.id, {
          status: "done",
          structuredText: structured,
          refinedBlocks: blocks,
          suggestedTitle: refined.title,
        });

        setVerifiedText((prev) => mergeStructuredText(prev, structured, pending.fileName));
        const incoming = blocks.length ? refinedBlocksToEditorBlocks(blocks) : plainTextToBlocks(structured);
        setEditorBlocks((prev) =>
          prev.length
            ? [...prev, createBlock("heading2", pending.fileName.replace(/&/g, "&amp;").replace(/</g, "&lt;")), ...incoming]
            : incoming,
        );
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : "Import step failed";
        updateItem(pending.id, { status: "error", error: message });
        setStatusMessage(message);
      } finally {
        setActiveStep(null);
        setActiveId(null);
        processingRef.current = false;
      }
    })();
  }, [queue, projectId, kind, updateItem]);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.dataTransfer.files.length) enqueueFiles(event.dataTransfer.files);
    },
    [enqueueFiles],
  );

  const pipelineBusy = activeStep !== null;
  const showWorkspace = queue.length > 0;
  const activeItem = queue.find((item) => item.id === activeId) ?? queue.find((item) => item.imageUrl);
  const doneCount = queue.filter((item) => item.status === "done").length;
  const queuePosition = activeId ? queue.findIndex((item) => item.id === activeId) + 1 : 0;

  const uploadWaitMessage = useRotatingWaitMessage(activeStep === "uploading", UPLOAD_WAIT_MESSAGES);
  const ocrWaitMessage = useRotatingWaitMessage(activeStep === "ocr", OCR_WAIT_MESSAGES);
  const refineWaitMessage = useRotatingWaitMessage(activeStep === "refine", REFINE_WAIT_MESSAGES);

  const pipelineWaitMessage =
    activeStep === "uploading"
      ? uploadWaitMessage
      : activeStep === "ocr"
        ? ocrWaitMessage
        : activeStep === "refine"
          ? refineWaitMessage
          : "";

  const statusLine =
    activeStep === "uploading"
      ? `Uploading image ${queuePosition} of ${queue.length}`
      : activeStep === "ocr"
        ? `Step 1 of 2 — reading image ${queuePosition} of ${queue.length}`
        : activeStep === "refine"
          ? `Step 2 of 2 — structuring image ${queuePosition} of ${queue.length}`
          : pipelineBusy
            ? "Processing queue…"
            : `Review combined text (${doneCount}/${queue.length} processed), then continue.`;

  const confirm = useCallback(() => {
    const sourceImages = queue
      .filter((item) => item.sourceImage)
      .map((item) => item.sourceImage!);
    if (sourceImages.length === 0) return;
    onComplete({
      ocrText: verifiedText,
      rawOcrText: rawOcrCombined || undefined,
      sourceImages,
      blocks: editorBlocks,
      suggestedTitle,
    });
  }, [onComplete, queue, verifiedText, rawOcrCombined, editorBlocks, suggestedTitle]);

  const resetAll = useCallback(() => {
    fileMapRef.current.clear();
    processingRef.current = false;
    setQueue([]);
    setActiveId(null);
    setActiveStep(null);
    setVerifiedText("");
    setRawOcrCombined("");
    setEditorBlocks([]);
    setSuggestedTitle(undefined);
    setStatusMessage(null);
    setError(null);
  }, []);

  return (
    <section
      className={`mx-auto flex w-full flex-col gap-8 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-14 sm:px-8 sm:pt-14 ${
        showWorkspace ? "max-w-[1280px]" : "max-w-[720px]"
      }`}
    >
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          {PROJECT_KIND_LABEL[kind]} · Import
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[var(--ink)]">Add source images</h1>
        <p className="max-w-lg text-base leading-relaxed text-[var(--ink-muted)]">
          Add up to {MAX_IMPORT_IMAGES} photos. We process them one at a time — upload, OCR, then structure — and merge
          the text for you to review.
        </p>
      </header>

      {!showWorkspace ? (
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--sidebar)] px-6 py-16 text-center transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:bg-[var(--sidebar-active)]"
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files?.length) enqueueFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <p className="text-sm font-medium text-[var(--ink)]">Drop images here or click to browse</p>
          <p className="text-xs text-[var(--ink-muted)]">
            Up to {MAX_IMPORT_IMAGES} images · JPEG, PNG, WebP, or GIF · 10 MB each
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-stretch">
          <div className="flex flex-col gap-3">
            {activeItem?.imageUrl ? (
              <figure className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--sidebar)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeItem.imageUrl}
                  alt={activeItem.fileName}
                  className="max-h-[min(320px,36vh)] w-full object-contain"
                />
              </figure>
            ) : (
              <div className="flex max-h-[min(320px,36vh)] min-h-[160px] items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--sidebar)] px-4 text-sm text-[var(--ink-muted)]">
                Waiting for upload…
              </div>
            )}

            <ul className="max-h-[280px] space-y-1 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--sidebar)] p-2 [scrollbar-gutter:stable]">
              {queue.map((item, index) => (
                <li
                  key={item.id}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                    item.id === activeId ? "bg-[var(--sidebar-active)]" : ""
                  }`}
                >
                  <span className="w-5 shrink-0 text-[var(--ink-muted)]">{index + 1}.</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--ink)]">{item.fileName}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${
                      item.status === "done"
                        ? "text-[#89b09a]"
                        : item.status === "error"
                          ? "text-[#e08a8a]"
                          : item.id === activeId
                            ? "text-[var(--ink)]"
                            : "text-[var(--ink-muted)]"
                    }`}
                  >
                    {stepLabel(item.status)}
                  </span>
                </li>
              ))}
            </ul>

            {queue.length < MAX_IMPORT_IMAGES ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-md border border-dashed border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-muted)] hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)]"
              >
                Add more images ({queue.length}/{MAX_IMPORT_IMAGES})
                {pipelineBusy ? " · queued after current" : ""}
              </button>
            ) : null}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="sr-only"
              onChange={(event) => {
                if (event.target.files?.length) enqueueFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <div className="flex min-h-[min(560px,calc(100dvh-11rem))] min-w-0 flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">
                Combined structured note
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">
                {pipelineBusy ? "Hang tight — we're working through the queue one image at a time." : statusLine}
              </p>
            </div>

            {pipelineBusy && editorBlocks.length === 0 ? (
              <div
                className="flex min-h-[min(480px,calc(100dvh-16rem))] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-6 py-8 text-center"
                aria-live="polite"
                aria-busy="true"
              >
                <p className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                  {statusLine}
                </p>
                <p className="max-w-sm text-sm leading-relaxed text-[var(--ink)]">{pipelineWaitMessage}</p>
                <p className="text-xs text-[var(--ink-muted)]">Queue runs upload → OCR → structure for each image.</p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                {pipelineBusy ? (
                  <p
                    className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-xs text-[var(--ink-muted)]"
                    aria-live="polite"
                  >
                    <span className="font-medium text-[var(--ink)]">{statusLine}</span>
                    {pipelineWaitMessage ? ` — ${pipelineWaitMessage}` : null}
                  </p>
                ) : null}
                {rawOcrCombined ? (
                  <details className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--sidebar)] px-3 py-2 text-xs text-[var(--ink-muted)]">
                    <summary className="cursor-pointer select-none text-[var(--ink)]">Raw OCR (all images)</summary>
                    <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap font-sans [scrollbar-gutter:stable]">
                      {rawOcrCombined}
                    </pre>
                  </details>
                ) : null}
                <div
                  id="verified-text"
                  className="min-h-[min(480px,calc(100dvh-16rem))] w-full flex-1 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-6 py-5 [scrollbar-gutter:stable]"
                >
                  <RichBlockEditor
                    blocks={editorBlocks.length ? editorBlocks : placeholderBlocks}
                    onBlocksChange={setEditorBlocks}
                    noteKind={kind}
                  />
                </div>
              </div>
            )}

            {statusMessage ? (
              <p className="rounded-md border border-[color-mix(in_srgb,#c45_40%,var(--line))] bg-[color-mix(in_srgb,#c45_12%,var(--sidebar))] px-3 py-2 text-xs text-[var(--ink)]">
                {statusMessage}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={confirm}
                disabled={pipelineBusy || doneCount === 0}
                className="rounded-md bg-[color-mix(in_srgb,var(--accent)_75%,#3a3228)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue to note
              </button>
              <button
                type="button"
                disabled={pipelineBusy}
                onClick={resetAll}
                className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
              >
                Clear & start over
              </button>
            </div>
          </div>
        </div>
      )}

      {error ? <p className="text-sm text-[#e08a8a]">{error}</p> : null}

      <button
        type="button"
        onClick={onSkip}
        className="self-start text-sm text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
      >
        Skip import and start with a blank note
      </button>
    </section>
  );
}

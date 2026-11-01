"use client";

import { useCallback, useRef } from "react";
import type { EditorSnapshot } from "../lib/editor-history";
import type { BlocksChangeMeta } from "../hooks/useEditorHistory";
import { RichBlockEditor } from "./RichBlockEditor";
import { PROJECT_KIND_LABEL, type BlockContent, type ProjectKind, type SourceImage } from "../lib/projects";

type NotionEditorProps = {
  kind: ProjectKind;
  title: string;
  blocks: BlockContent[];
  sourceImage?: SourceImage;
  sourceImages?: SourceImage[];
  onTitleChange: (title: string) => void;
  onBlocksChange: (blocks: BlockContent[], meta?: BlocksChangeMeta) => void;
  onHistoryFlush?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => EditorSnapshot | null;
  onRedo?: () => EditorSnapshot | null;
  historyRevision?: number;
  /** Breadcrumb for sub-pages. */
  parent?: { id: string; title: string };
  onCreateSubpage?: (title: string, blocks: BlockContent[]) => string | null;
  onOpenPage?: (pageId: string) => void;
  resolvePageTitle?: (pageId: string) => string | null;
};

function SourceImagesRail({ images }: { images: SourceImage[] }) {
  return (
    <aside
      className="hidden shrink-0 lg:block lg:w-[200px] xl:w-[220px]"
      aria-label="Source images"
    >
      <div className="sticky top-[72px] flex max-h-[calc(100vh-6rem)] flex-col gap-2 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        <p className="px-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--ink-muted)]">
          Sources · {images.length}
        </p>
        {images.map((image, index) => (
          <figure
            key={image.key}
            className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--sidebar)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/media/${image.key}`}
              alt={image.fileName ?? `Source ${index + 1}`}
              className="max-h-28 w-full object-contain p-1"
            />
            <figcaption className="truncate border-t border-[var(--line)] px-2 py-1 text-[10px] leading-tight text-[var(--ink-muted)]">
              {image.fileName ?? `#${index + 1}`}
            </figcaption>
          </figure>
        ))}
      </div>
    </aside>
  );
}

function SourceImagesMobileStrip({ images }: { images: SourceImage[] }) {
  return (
    <div className="mb-6 lg:hidden">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--ink-muted)]">
        Source images
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-gutter:stable]">
        {images.map((image, index) => (
          <figure
            key={image.key}
            className="w-24 shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--sidebar)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/media/${image.key}`}
              alt={image.fileName ?? `Source ${index + 1}`}
              className="h-20 w-full object-contain p-0.5"
            />
          </figure>
        ))}
      </div>
    </div>
  );
}

function HistoryButton({
  label,
  disabled,
  onClick,
  title,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      className="rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-2 py-1 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export function NotionEditor({
  kind,
  title,
  blocks,
  sourceImage,
  sourceImages,
  onTitleChange,
  onBlocksChange,
  onHistoryFlush,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  historyRevision = 0,
  parent,
  onCreateSubpage,
  onOpenPage,
  resolvePageTitle,
}: NotionEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const images =
    sourceImages && sourceImages.length > 0
      ? sourceImages
      : sourceImage
        ? [sourceImage]
        : [];

  const hasImages = images.length > 0;

  const handleEditorKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const root = rootRef.current;
      if (!root) return;
      const target = event.target;
      if (!(target instanceof Node) || !root.contains(target)) return;
      if (target instanceof HTMLElement && target.closest(".go-deeper, .slash-menu")) return;

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey && canUndo && onUndo) {
        event.preventDefault();
        onUndo();
        return;
      }
      if ((key === "z" && event.shiftKey) || key === "y") {
        if (!canRedo || !onRedo) return;
        event.preventDefault();
        onRedo();
      }
    },
    [canRedo, canUndo, onRedo, onUndo],
  );

  return (
    <div
      ref={rootRef}
      onKeyDownCapture={handleEditorKeyDown}
      className={`mx-auto flex w-full gap-8 px-6 pb-24 pt-16 sm:px-8 sm:pt-[72px] ${
        hasImages ? "max-w-[1120px] lg:max-w-[980px] xl:max-w-[1040px]" : "max-w-[720px]"
      }`}
    >
      <article className="min-w-0 flex-1">
        {parent ? (
          <button
            type="button"
            onClick={() => onOpenPage?.(parent.id)}
            className="mb-3 mr-2 inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--sidebar-active)] hover:text-[var(--ink)]"
          >
            ← {parent.title}
          </button>
        ) : null}
        <p className="mb-3 inline-flex rounded-md border border-[var(--line)] px-2 py-0.5 text-xs font-medium text-[var(--ink-muted)]">
          {PROJECT_KIND_LABEL[kind]}
        </p>
        <input
          type="text"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={() => onHistoryFlush?.()}
          placeholder={`Untitled ${PROJECT_KIND_LABEL[kind]}`}
          aria-label="Page title"
          className="editable-surface mb-2 w-full border-none bg-transparent text-[2.5rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)] caret-[var(--caret)] placeholder:text-[var(--ink-muted)] outline-none selection:bg-[var(--selection-bg)] selection:text-[var(--selection-fg)]"
        />

        {hasImages ? <SourceImagesMobileStrip images={images} /> : null}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <HistoryButton
            label="Undo"
            disabled={!canUndo}
            onClick={() => onUndo?.()}
            title="Undo (Ctrl+Z)"
          />
          <HistoryButton
            label="Redo"
            disabled={!canRedo}
            onClick={() => onRedo?.()}
            title="Redo (Ctrl+Shift+Z)"
          />
          <span className="text-xs text-[var(--ink-muted)]">
            Select text to format · Type{" "}
            <kbd className="rounded border border-[var(--line)] px-1 py-0.5 font-mono text-[10px]">/</kbd> for blocks ·{" "}
            <kbd className="rounded border border-[var(--line)] px-1 py-0.5 font-mono text-[10px]">#</kbd>{" "}
            <kbd className="rounded border border-[var(--line)] px-1 py-0.5 font-mono text-[10px]">-</kbd>{" "}
            <kbd className="rounded border border-[var(--line)] px-1 py-0.5 font-mono text-[10px]">&gt;</kbd> shortcuts
          </span>
        </div>

        <RichBlockEditor
          blocks={blocks}
          onBlocksChange={onBlocksChange}
          noteKind={kind}
          className="mt-2"
          historyRevision={historyRevision}
          onCreateSubpage={onCreateSubpage}
          onOpenPage={onOpenPage}
          resolvePageTitle={resolvePageTitle}
        />
      </article>

      {hasImages ? <SourceImagesRail images={images} /> : null}
    </div>
  );
}

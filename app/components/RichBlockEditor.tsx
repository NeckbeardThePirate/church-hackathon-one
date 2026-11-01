"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  autoFormatBlocksToEditorBlocks,
  replaceBlockRange,
  replaceDocumentContent,
  requestAutoFormat,
  resolveSelectionFormatTarget,
  serializeBlocksForFormat,
  stripHtmlToPlain,
} from "../lib/auto-format-client";
import { filterSlashCommands, nextBlockTypeAfterEnter, type BlockType } from "../lib/block-types";
import type { HistoryKind } from "../lib/editor-history";
import type { BlocksChangeMeta } from "../hooks/useEditorHistory";
import { createBlock, isNonTextBlock, type BlockContent, type DeeperState, type ProjectKind } from "../lib/projects";
import { deeperToPageBlocks } from "../lib/deeper-to-page";
import { useScriptureEnrichment } from "../hooks/useScriptureEnrichment";
import { BibleCalloutBlock } from "./BibleCalloutBlock";
import { EditorBlock } from "./EditorBlock";
import { DeeperBlock, DeeperDock, PageLinkBlock } from "./DeeperBlock";
import type { DeeperInsert } from "./GoDeeperPanel";
import { FormatToolbar } from "./FormatToolbar";
import { getSlashCommandAt, SlashMenu } from "./SlashMenu";

type RichBlockEditorProps = {
  blocks: BlockContent[];
  onBlocksChange: (blocks: BlockContent[], meta?: BlocksChangeMeta) => void;
  className?: string;
  noteKind?: ProjectKind;
  showDocumentAutoFormat?: boolean;
  historyRevision?: number;
  /** Creates a sub-page of the current page; returns its id. */
  onCreateSubpage?: (title: string, blocks: BlockContent[]) => string | null;
  onOpenPage?: (pageId: string) => void;
  resolvePageTitle?: (pageId: string) => string | null;
};

type SlashState = {
  blockId: string;
  query: string;
};

function pickFocusBlockId(blocks: BlockContent[], preferredId: string | null): string | null {
  const editable = blocks.filter(
    (item) => !isNonTextBlock(item) && item.type !== "divider",
  );
  if (preferredId && editable.some((item) => item.id === preferredId)) return preferredId;
  return editable[0]?.id ?? null;
}

export function RichBlockEditor({
  blocks,
  onBlocksChange,
  className = "",
  noteKind,
  showDocumentAutoFormat = true,
  historyRevision = 0,
  onCreateSubpage,
  onOpenPage,
  resolvePageTitle,
}: RichBlockEditorProps) {
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [editorRoot, setEditorRoot] = useState<HTMLElement | null>(null);
  const [autoFormatBusy, setAutoFormatBusy] = useState(false);
  const [autoFormatError, setAutoFormatError] = useState<string | null>(null);
  const [busyBlockId, setBusyBlockId] = useState<string | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const blocksRef = useRef(blocks);
  const lastFocusedBlockRef = useRef<string | null>(null);
  const lastHistoryRevisionRef = useRef(historyRevision);
  blocksRef.current = blocks;

  const emitBlocks = useCallback(
    (next: BlockContent[], history: HistoryKind) => {
      onBlocksChange(next, { history });
    },
    [onBlocksChange],
  );

  const setArticleNode = useCallback((node: HTMLElement | null) => {
    articleRef.current = node;
    setEditorRoot(node);
  }, []);

  const clearFocus = useCallback(() => setFocusBlockId(null), []);

  useScriptureEnrichment(blocks, onBlocksChange);

  useEffect(() => {
    if (historyRevision === lastHistoryRevisionRef.current) return;
    lastHistoryRevisionRef.current = historyRevision;
    const focusId = pickFocusBlockId(blocksRef.current, lastFocusedBlockRef.current);
    setFocusBlockId(focusId);
  }, [historyRevision]);

  const trackFocus = useCallback((blockId: string) => {
    lastFocusedBlockRef.current = blockId;
  }, []);

  const numberedIndexes = useMemo(() => {
    const map = new Map<string, number>();
    let counter = 0;
    for (const block of blocks) {
      if (isNonTextBlock(block) || (block.type === "quote" && block.bibleReference)) {
        counter = 0;
        continue;
      }
      if (block.type === "numbered") {
        counter += 1;
        map.set(block.id, counter);
      } else {
        counter = 0;
      }
    }
    return map;
  }, [blocks]);

  const updateBlockHtml = useCallback(
    (blockId: string, html: string, history: HistoryKind = "grouped") => {
      trackFocus(blockId);
      emitBlocks(
        blocksRef.current.map((block) => (block.id === blockId ? { ...block, html } : block)),
        history,
      );
    },
    [emitBlocks, trackFocus],
  );

  const handleBlockInput = useCallback(
    (blockId: string, html: string) => {
      trackFocus(blockId);
      updateBlockHtml(blockId, html, "grouped");
    },
    [trackFocus, updateBlockHtml],
  );

  const persistActiveEditable = useCallback(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    const blockId = active.closest("[data-block-id]")?.getAttribute("data-block-id");
    if (!blockId) return;
    if (!active.isContentEditable) return;
    updateBlockHtml(blockId, active.innerHTML, "immediate");
  }, [updateBlockHtml]);

  const handleEnter = useCallback(
    (blockId: string) => {
      const currentBlocks = blocksRef.current;
      const block = currentBlocks.find((item) => item.id === blockId);
      if (!block || isNonTextBlock(block)) return;
      if (block.type === "quote" && block.bibleReference) return;

      if (block.type === "divider") return;

      // Empty list/quote item turns back into a paragraph (Notion behavior).
      const empty = block.html.replace(/<br\s*\/?>/gi, "").replace(/&nbsp;/g, "").trim() === "";
      if (empty && (block.type === "bullet" || block.type === "numbered" || block.type === "quote")) {
        emitBlocks(
          currentBlocks.map((item) => (item.id === blockId ? { ...item, type: "paragraph", html: "" } : item)),
          "immediate",
        );
        setFocusBlockId(blockId);
        return;
      }

      const next = createBlock(nextBlockTypeAfterEnter(block.type));
      const index = currentBlocks.findIndex((item) => item.id === blockId);
      if (index === -1) return;
      const copy = [...currentBlocks];
      copy.splice(index + 1, 0, next);
      trackFocus(next.id);
      emitBlocks(copy, "immediate");
      setFocusBlockId(next.id);
    },
    [emitBlocks, trackFocus],
  );

  const handleBackspaceEmpty = useCallback(
    (blockId: string) => {
      const currentBlocks = blocksRef.current;
      if (currentBlocks.length <= 1) {
        emitBlocks([{ ...createBlock(), id: blockId }], "immediate");
        setFocusBlockId(blockId);
        return;
      }
      const index = currentBlocks.findIndex((item) => item.id === blockId);
      if (index === -1) return;

      const previousEditable = [...currentBlocks]
        .slice(0, index)
        .reverse()
        .find((item) => !isNonTextBlock(item));

      const nextBlocks = currentBlocks.filter((item) => item.id !== blockId);
      emitBlocks(nextBlocks.length ? nextBlocks : [createBlock()], "immediate");
      setFocusBlockId(previousEditable?.id ?? nextBlocks[0]?.id ?? null);
    },
    [emitBlocks],
  );

  const handleChangeType = useCallback(
    (blockId: string, type: BlockType, html?: string) => {
      const currentBlocks = blocksRef.current;
      const index = currentBlocks.findIndex((item) => item.id === blockId);
      if (index === -1) return;

      const updated = currentBlocks.map((item) =>
        item.id === blockId
          ? { ...item, type, html: html !== undefined ? html : type === "divider" ? "" : item.html }
          : item,
      );

      // After converting to a divider, ensure a following paragraph for typing.
      if (type === "divider") {
        const following = updated[index + 1];
        if (!following || isNonTextBlock(following) || following.type === "divider") {
          const next = createBlock("paragraph");
          updated.splice(index + 1, 0, next);
          emitBlocks(updated, "immediate");
          setFocusBlockId(next.id);
          setSlash(null);
          return;
        }
        emitBlocks(updated, "immediate");
        setFocusBlockId(following.id);
        setSlash(null);
        return;
      }

      emitBlocks(updated, "immediate");
      setFocusBlockId(blockId);
      setSlash(null);
    },
    [emitBlocks],
  );

  const handleSlashQuery = useCallback((blockId: string, query: string | null) => {
    if (query === null) {
      setSlash((prev) => (prev?.blockId === blockId ? null : prev));
      return;
    }
    setSlash({ blockId, query });
    setSlashIndex(0);
  }, []);

  const handleSlashPick = useCallback(
    (type: BlockType) => {
      if (!slash) return;
      handleChangeType(slash.blockId, type, "");
    },
    [handleChangeType, slash],
  );

  const handleNavigate = useCallback(
    (blockId: string, direction: "up" | "down") => {
      const editable = blocksRef.current.filter((item) => !isNonTextBlock(item));
      const index = editable.findIndex((item) => item.id === blockId);
      if (index === -1) return;
      const target = direction === "up" ? editable[index - 1] : editable[index + 1];
      if (!target) return;
      if (target.type === "divider") {
        const skip = direction === "up" ? editable[index - 2] : editable[index + 2];
        if (skip) setFocusBlockId(skip.id);
        return;
      }
      setFocusBlockId(target.id);
    },
    [],
  );

  const handleRequestFormatPersist = useCallback(
    (blockId: string) => {
      const el = articleRef.current?.querySelector<HTMLElement>(
        `[data-block-id="${blockId}"] [contenteditable="true"]`,
      );
      if (el) updateBlockHtml(blockId, el.innerHTML);
    },
    [updateBlockHtml],
  );

  type DeeperBlockT = BlockContent & { deeper: DeeperState };
  const isDeeper = (b: BlockContent): b is DeeperBlockT => b.kind === "deeper" && !!b.deeper;

  /** Opens (or toggles) the Go Deeper thread for a block. Threads are saved as blocks right after their source. */
  const handleGoDeeper = useCallback(
    (blockId: string) => {
      const all = blocksRef.current;
      const index = all.findIndex((item) => item.id === blockId);
      const block = all[index];
      if (!block) return;
      const existing = all.find((b): b is DeeperBlockT => isDeeper(b) && b.deeper.sourceBlockId === blockId);
      if (existing) {
        const collapse = !existing.deeper.collapsed;
        emitBlocks(
          all.map((b) =>
            isDeeper(b)
              ? b.id === existing.id
                ? { ...b, deeper: { ...b.deeper, collapsed: collapse } }
                : collapse
                  ? b
                  : { ...b, deeper: { ...b.deeper, collapsed: true } }
              : b,
          ),
          "immediate",
        );
        return;
      }
      const plain = (html: string) => {
        const el = document.createElement("div");
        el.innerHTML = html;
        return (el.textContent ?? "").trim();
      };
      const text = plain(block.html);
      if (!text) return;
      // Surrounding notes give the AI explanation context (nearest ~8 before, ~3 after).
      const textBlocks = (list: BlockContent[]) => list.filter((b) => !isNonTextBlock(b)).map((b) => plain(b.html)).filter(Boolean);
      const before = textBlocks(all.slice(Math.max(0, index - 8), index)).join("\n");
      const after = textBlocks(all.slice(index + 1, index + 5)).join("\n");
      const thread: BlockContent = {
        ...createBlock("paragraph", ""),
        kind: "deeper",
        deeper: { sourceBlockId: blockId, text, before, after, collapsed: false },
      };
      // Only one expanded thread at a time keeps the sources sidebar unambiguous.
      const next = all.map((b) => (isDeeper(b) && !b.deeper.collapsed ? { ...b, deeper: { ...b.deeper, collapsed: true } } : b));
      let insertAt = index + 1;
      while (next[insertAt] && next[insertAt]!.type === "quote" && next[insertAt]!.bibleReference) insertAt += 1;
      next.splice(insertAt, 0, thread);
      emitBlocks(next, "immediate");
    },
    [emitBlocks],
  );

  const updateDeeper = useCallback(
    (blockId: string, patch: Partial<DeeperState>, history: HistoryKind = "grouped") => {
      emitBlocks(
        blocksRef.current.map((b) =>
          b.id === blockId && b.deeper ? { ...b, deeper: { ...b.deeper, ...patch } } : b,
        ),
        history,
      );
    },
    [emitBlocks],
  );

  const expandDeeper = useCallback(
    (blockId: string) => {
      emitBlocks(
        blocksRef.current.map((b) =>
          isDeeper(b) ? { ...b, deeper: { ...b.deeper, collapsed: b.id !== blockId } } : b,
        ),
        "immediate",
      );
      window.setTimeout(() => {
        document.querySelector(`[data-deeper-id="${blockId}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 60);
    },
    [emitBlocks],
  );

  const removeBlock = useCallback(
    (blockId: string) => {
      const next = blocksRef.current.filter((b) => b.id !== blockId);
      emitBlocks(next.length ? next : [createBlock()], "immediate");
    },
    [emitBlocks],
  );

  const makeDeeperPage = useCallback(
    (blockId: string, live: { data: DeeperState["data"] | null; messages: DeeperState["messages"] }) => {
      const block = blocksRef.current.find((b): b is DeeperBlockT => b.id === blockId && isDeeper(b));
      if (!block || !onCreateSubpage) return;
      const state: DeeperState = { ...block.deeper, data: live.data ?? block.deeper.data, messages: live.messages ?? block.deeper.messages };
      const title = state.data?.theme || state.text.slice(0, 60);
      const pageId = onCreateSubpage(title, deeperToPageBlocks(state));
      if (!pageId) return;
      emitBlocks(
        blocksRef.current.map((b) => (b.id === blockId ? { id: b.id, type: "paragraph", html: "", kind: "page-link", pageId } : b)),
        "immediate",
      );
    },
    [emitBlocks, onCreateSubpage],
  );

  const runAutoFormat = useCallback(
    async (options: {
      scope: "document" | "block" | "selection";
      text: string;
      startIndex?: number;
      endIndex?: number;
      blockId?: string;
    }) => {
      if (autoFormatBusy) return;
      const text = options.text.trim();
      if (!text) {
        setAutoFormatError("Nothing to format.");
        return;
      }

      setAutoFormatBusy(true);
      setBusyBlockId(options.blockId ?? null);
      setAutoFormatError(null);
      try {
        const formatted = await requestAutoFormat({
          text,
          scope: options.scope,
          noteKind,
        });
        const nextBlocks = autoFormatBlocksToEditorBlocks(formatted);
        const current = blocksRef.current;

        if (options.scope === "document") {
          emitBlocks(replaceDocumentContent(current, nextBlocks), "immediate");
          setFocusBlockId(nextBlocks[0]?.id ?? null);
        } else if (
          typeof options.startIndex === "number" &&
          typeof options.endIndex === "number"
        ) {
          emitBlocks(
            replaceBlockRange(current, options.startIndex, options.endIndex, nextBlocks),
            "immediate",
          );
          setFocusBlockId(nextBlocks[0]?.id ?? null);
        }
      } catch (error) {
        setAutoFormatError(error instanceof Error ? error.message : "Auto format failed");
      } finally {
        setAutoFormatBusy(false);
        setBusyBlockId(null);
      }
    },
    [autoFormatBusy, noteKind, emitBlocks],
  );

  const handleAutoFormatDocument = useCallback(() => {
    const text = serializeBlocksForFormat(blocksRef.current);
    void runAutoFormat({ scope: "document", text });
  }, [runAutoFormat]);

  const handleAutoFormatBlock = useCallback(
    (blockId: string) => {
      const current = blocksRef.current;
      const index = current.findIndex((block) => block.id === blockId);
      if (index === -1) return;
      const block = current[index]!;
      if (isNonTextBlock(block) || block.type === "divider") return;
      const text = stripHtmlToPlain(block.html);
      void runAutoFormat({
        scope: "block",
        text,
        startIndex: index,
        endIndex: index,
        blockId,
      });
    },
    [runAutoFormat],
  );

  const handleAutoFormatSelection = useCallback(() => {
    if (!editorRoot) return;
    persistActiveEditable();
    const target = resolveSelectionFormatTarget(editorRoot, blocksRef.current);
    if (!target) {
      setAutoFormatError("Select some text to auto format.");
      return;
    }
    void runAutoFormat({
      scope: "selection",
      text: target.text,
      startIndex: target.startIndex,
      endIndex: target.endIndex,
    });
  }, [editorRoot, persistActiveEditable, runAutoFormat]);

  const handleDeeperInsert = useCallback(
    (deeperBlockId: string, item: DeeperInsert) => {
      const current = blocksRef.current;
      const index = current.findIndex((block) => block.id === deeperBlockId);
      if (index === -1) return;
      const esc = (value: string) =>
        value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      // References become a paragraph; scripture enrichment then links it and adds the BSB quote.
      const next =
        item.kind === "reference"
          ? createBlock("paragraph", esc(item.reference))
          : createBlock("quote", `${esc(item.text)}<br>— ${esc(item.attribution)}`);
      const copy = [...current];
      copy.splice(index + 1, 0, next);
      emitBlocks(copy, "immediate");
    },
    [emitBlocks],
  );

  const onEditorKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!slash) return;
      const maxIndex = Math.max(0, filterSlashCommands(slash.query).length - 1);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setSlashIndex((index) => Math.min(maxIndex, index + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setSlashIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const command = getSlashCommandAt(slash.query, slashIndex);
        if (command) {
          event.preventDefault();
          event.stopPropagation();
          handleSlashPick(command.id);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSlash(null);
      }
    },
    [handleSlashPick, slash, slashIndex],
  );

  return (
    <div
      ref={setArticleNode}
      className={`relative ${className}${autoFormatBusy ? " editor-auto-formatting" : ""}`}
      aria-busy={autoFormatBusy || undefined}
      onKeyDownCapture={onEditorKeyDown}
    >
      {showDocumentAutoFormat ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={autoFormatBusy}
            onClick={handleAutoFormatDocument}
            className="rounded-md border border-[var(--line)] bg-[var(--sidebar)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-60"
            title="Restructure the whole note with AI"
          >
            {autoFormatBusy && !busyBlockId ? "Formatting note…" : "Auto Format note"}
          </button>
          <span className="text-[11px] text-[var(--ink-muted)]">
            Or hover a block / select text for contextual Auto Format
          </span>
        </div>
      ) : null}
      {autoFormatError ? (
        <p className="mb-2 text-xs text-[#e0a0a0]" role="status">
          {autoFormatError}
        </p>
      ) : null}
      <FormatToolbar
        editorRoot={editorRoot}
        onFormatted={persistActiveEditable}
        onAutoFormatSelection={handleAutoFormatSelection}
        autoFormatBusy={autoFormatBusy}
      />
      {slash && editorRoot ? (
        <SlashMenu
          query={slash.query}
          blockId={slash.blockId}
          editorRoot={editorRoot}
          selectedIndex={slashIndex}
          onSelectedIndexChange={setSlashIndex}
          onPick={handleSlashPick}
          onClose={() => setSlash(null)}
        />
      ) : null}
      <div className="flex flex-col gap-1">
        {blocks.map((block, index) =>
          isDeeper(block) ? (
            <DeeperBlock
              key={block.id}
              block={block}
              noteKind={noteKind}
              onChange={(patch) => updateDeeper(block.id, patch, "collapsed" in patch ? "immediate" : "grouped")}
              onExpand={() => expandDeeper(block.id)}
              onInsert={(item) => handleDeeperInsert(block.id, item)}
              onMakePage={onCreateSubpage ? (live) => makeDeeperPage(block.id, live) : () => undefined}
              onDiscard={() => removeBlock(block.id)}
            />
          ) : block.kind === "page-link" && block.pageId ? (
            <PageLinkBlock
              key={block.id}
              title={resolvePageTitle?.(block.pageId) ?? "Untitled"}
              missing={resolvePageTitle ? resolvePageTitle(block.pageId) === null : false}
              onOpen={() => block.pageId && onOpenPage?.(block.pageId)}
              onRemove={() => removeBlock(block.id)}
            />
          ) : block.kind === "bible-callout" ? (
            <BibleCalloutBlock
              key={block.id}
              block={block}
              onRemove={() =>
                emitBlocks(
                  blocks.filter((item) => item.id !== block.id),
                  "immediate",
                )
              }
            />
          ) : (
            <div key={`${block.id}-${block.type ?? "paragraph"}`}>
              <EditorBlock
                key={`${block.id}-${block.type ?? "paragraph"}`}
                blockId={block.id}
                type={block.type ?? "paragraph"}
                isFirst={index === 0}
                listIndex={numberedIndexes.get(block.id) ?? 1}
                initialHtml={block.html}
                autoFocus={focusBlockId === block.id}
                onFocused={clearFocus}
                historyRevision={historyRevision}
                onInput={handleBlockInput}
                onEnter={handleEnter}
                onBackspaceEmpty={handleBackspaceEmpty}
                onChangeType={handleChangeType}
                onSlashQuery={handleSlashQuery}
                onNavigate={handleNavigate}
                onRequestFormatPersist={handleRequestFormatPersist}
                onGoDeeper={block.type === "divider" ? undefined : handleGoDeeper}
                onAutoFormat={block.type === "divider" ? undefined : handleAutoFormatBlock}
                autoFormatBusy={autoFormatBusy && busyBlockId === block.id}
              />
            </div>
          ),
        )}
      </div>
      <DeeperDock threads={blocks.filter(isDeeper)} onOpen={expandDeeper} />
    </div>
  );
}

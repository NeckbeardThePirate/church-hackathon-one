"use client";

import { useEffect, useRef } from "react";
import {
  enrichBlocksWithScripture,
  fetchPassageForReference,
  fetchVerseTextMatch,
} from "../lib/bible/enrich-blocks";
import type { BlockContent } from "../lib/projects";
import type { BlocksChangeMeta } from "./useEditorHistory";

export function useScriptureEnrichment(
  blocks: BlockContent[],
  onBlocksChange: (blocks: BlockContent[], meta?: BlocksChangeMeta) => void,
): void {
  const blocksRef = useRef(blocks);
  const timerRef = useRef<number | null>(null);
  const enrichingRef = useRef(false);

  blocksRef.current = blocks;

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(() => {
      void (async () => {
        if (enrichingRef.current) return;
        enrichingRef.current = true;
        try {
          const current = blocksRef.current;
          const enriched = await enrichBlocksWithScripture(
            current,
            fetchPassageForReference,
            fetchVerseTextMatch,
          );
          if (enriched === current) return;
          if (blocksRef.current !== current) {
            // User kept typing while passages loaded — re-run on latest content next debounce.
            return;
          }
          onBlocksChange(enriched, { history: "grouped" });
        } finally {
          enrichingRef.current = false;
        }
      })();
    }, 900);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [blocks, onBlocksChange]);
}

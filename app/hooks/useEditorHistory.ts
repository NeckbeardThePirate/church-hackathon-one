"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applySnapshotChange,
  cloneSnapshot,
  createHistoryState,
  endHistoryGroup,
  flushGroupedHistory,
  GROUP_IDLE_MS,
  redoHistory,
  snapshotsEqual,
  type EditorSnapshot,
  type HistoryKind,
  type HistoryState,
  undoHistory,
} from "../lib/editor-history";

export type BlocksChangeMeta = { history: HistoryKind };

export function useEditorHistory() {
  const [state, setState] = useState<HistoryState | null>(null);
  const groupTimerRef = useRef<number | null>(null);
  const isRestoringRef = useRef(false);
  const onPresentChangeRef = useRef<(snapshot: EditorSnapshot) => void>(() => {});

  const clearGroupTimer = useCallback(() => {
    if (groupTimerRef.current !== null) {
      window.clearTimeout(groupTimerRef.current);
      groupTimerRef.current = null;
    }
  }, []);

  const scheduleGroupEnd = useCallback(() => {
    clearGroupTimer();
    groupTimerRef.current = window.setTimeout(() => {
      groupTimerRef.current = null;
      setState((prev) => (prev ? endHistoryGroup(prev) : prev));
    }, GROUP_IDLE_MS);
  }, [clearGroupTimer]);

  const reset = useCallback(
    (snapshot: EditorSnapshot) => {
      clearGroupTimer();
      isRestoringRef.current = false;
      setState(createHistoryState(snapshot));
    },
    [clearGroupTimer],
  );

  const setOnPresentChange = useCallback((handler: (snapshot: EditorSnapshot) => void) => {
    onPresentChangeRef.current = handler;
  }, []);

  const setSnapshot = useCallback(
    (next: EditorSnapshot, kind: HistoryKind) => {
      setState((prev) => {
        if (!prev) return prev;
        const recording = !isRestoringRef.current;
        const { state: nextState, scheduleGroupEnd: shouldSchedule } = applySnapshotChange(
          prev,
          next,
          kind,
          recording,
        );
        if (recording && !snapshotsEqual(prev.present, nextState.present)) {
          onPresentChangeRef.current(nextState.present);
        }
        if (shouldSchedule && recording) scheduleGroupEnd();
        if (kind === "immediate" && recording) clearGroupTimer();
        return nextState;
      });
    },
    [clearGroupTimer, scheduleGroupEnd],
  );

  const flush = useCallback(() => {
    clearGroupTimer();
    setState((prev) => (prev ? flushGroupedHistory(prev) : prev));
  }, [clearGroupTimer]);

  const undo = useCallback((): EditorSnapshot | null => {
    clearGroupTimer();
    isRestoringRef.current = true;
    let result: EditorSnapshot | null = null;
    setState((prev) => {
      if (!prev) return prev;
      const { state: nextState, applied } = undoHistory(flushGroupedHistory(prev));
      if (!applied) return prev;
      result = cloneSnapshot(nextState.present);
      onPresentChangeRef.current(nextState.present);
      return nextState;
    });
    isRestoringRef.current = false;
    return result;
  }, [clearGroupTimer]);

  const redo = useCallback((): EditorSnapshot | null => {
    clearGroupTimer();
    isRestoringRef.current = true;
    let result: EditorSnapshot | null = null;
    setState((prev) => {
      if (!prev) return prev;
      const { state: nextState, applied } = redoHistory(prev);
      if (!applied) return prev;
      result = cloneSnapshot(nextState.present);
      onPresentChangeRef.current(nextState.present);
      return nextState;
    });
    isRestoringRef.current = false;
    return result;
  }, [clearGroupTimer]);

  useEffect(() => () => clearGroupTimer(), [clearGroupTimer]);

  return {
    reset,
    setSnapshot,
    flush,
    undo,
    redo,
    canUndo: (state?.past.length ?? 0) > 0,
    canRedo: (state?.future.length ?? 0) > 0,
    revision: state?.revision ?? 0,
    present: state?.present ?? null,
    setOnPresentChange,
  };
}

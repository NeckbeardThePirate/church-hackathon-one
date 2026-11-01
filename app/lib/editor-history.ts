import type { BlockContent } from "./projects";

export type EditorSnapshot = {
  title: string;
  blocks: BlockContent[];
};

export type HistoryKind = "grouped" | "immediate";

const MAX_PAST = 50;
const GROUP_IDLE_MS = 400;

function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    title: snapshot.title,
    blocks: structuredClone(snapshot.blocks),
  };
}

export function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  if (a.title !== b.title) return false;
  return JSON.stringify(a.blocks) === JSON.stringify(b.blocks);
}

export type HistoryState = {
  past: EditorSnapshot[];
  future: EditorSnapshot[];
  present: EditorSnapshot;
  revision: number;
  inGroup: boolean;
};

export function createHistoryState(snapshot: EditorSnapshot): HistoryState {
  return {
    past: [],
    future: [],
    present: cloneSnapshot(snapshot),
    revision: 0,
    inGroup: false,
  };
}

function trimPast(past: EditorSnapshot[]): EditorSnapshot[] {
  if (past.length <= MAX_PAST) return past;
  return past.slice(past.length - MAX_PAST);
}

export type ApplyChangeResult = {
  state: HistoryState;
  /** End the typing group after idle (caller schedules timer). */
  scheduleGroupEnd: boolean;
};

/** Record a document change. Pass `recording: false` while applying undo/redo. */
export function applySnapshotChange(
  state: HistoryState,
  next: EditorSnapshot,
  kind: HistoryKind,
  recording: boolean,
): ApplyChangeResult {
  if (snapshotsEqual(state.present, next)) {
    return { state, scheduleGroupEnd: kind === "grouped" && recording };
  }

  if (!recording) {
    return {
      state: { ...state, present: cloneSnapshot(next) },
      scheduleGroupEnd: false,
    };
  }

  if (kind === "immediate") {
    const past = trimPast([...state.past, cloneSnapshot(state.present)]);
    return {
      state: {
        past,
        future: [],
        present: cloneSnapshot(next),
        revision: state.revision,
        inGroup: false,
      },
      scheduleGroupEnd: false,
    };
  }

  // grouped
  if (!state.inGroup) {
    const past = trimPast([...state.past, cloneSnapshot(state.present)]);
    return {
      state: {
        past,
        future: [],
        present: cloneSnapshot(next),
        revision: state.revision,
        inGroup: true,
      },
      scheduleGroupEnd: true,
    };
  }

  return {
    state: {
      ...state,
      present: cloneSnapshot(next),
      inGroup: true,
    },
    scheduleGroupEnd: true,
  };
}

export function endHistoryGroup(state: HistoryState): HistoryState {
  if (!state.inGroup) return state;
  return { ...state, inGroup: false };
}

export function flushGroupedHistory(state: HistoryState): HistoryState {
  return endHistoryGroup(state);
}

export type UndoRedoResult = {
  state: HistoryState;
  applied: boolean;
};

export function undoHistory(state: HistoryState): UndoRedoResult {
  if (state.past.length === 0) return { state, applied: false };
  const previous = state.past[state.past.length - 1]!;
  const past = state.past.slice(0, -1);
  const future = [cloneSnapshot(state.present), ...state.future];
  return {
    applied: true,
    state: {
      past,
      future,
      present: cloneSnapshot(previous),
      revision: state.revision + 1,
      inGroup: false,
    },
  };
}

export function redoHistory(state: HistoryState): UndoRedoResult {
  if (state.future.length === 0) return { state, applied: false };
  const next = state.future[0]!;
  const future = state.future.slice(1);
  const past = trimPast([...state.past, cloneSnapshot(state.present)]);
  return {
    applied: true,
    state: {
      past,
      future,
      present: cloneSnapshot(next),
      revision: state.revision + 1,
      inGroup: false,
    },
  };
}

export { GROUP_IDLE_MS, cloneSnapshot };

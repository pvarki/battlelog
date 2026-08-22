import type { Widget } from "../api.ts";

/** One undoable state of the dashboard document. */
export type Snapshot = { name: string; widgets: Widget[] };

export type History = {
  entries: Snapshot[];
  /** Indexes the current state; anything after it is the redo tail. */
  cursor: number;
  /** Which gesture produced the top entry, or null if none is open. */
  key: string | null;
};

// Snapshots share structure with the live state (persist replaces the widgets
// array wholesale and reuses untouched widgets), so depth is nearly free.
const LIMIT = 50;

export const newHistory = (initial: Snapshot): History => ({
  entries: [initial],
  cursor: 0,
  key: null,
});

/**
 * Push a state. `coalesceKey` collapses a continuous edit into a single entry —
 * successive keystrokes in one widget's config form, or every layout change
 * within one drag. Structural edits pass null and always push, and the first
 * edit always pushes so the original state stays reachable.
 */
export const record = (h: History, next: Snapshot, coalesceKey: string | null): void => {
  h.entries.length = h.cursor + 1; // a new edit abandons the redo tail
  if (coalesceKey !== null && coalesceKey === h.key && h.cursor > 0) {
    h.entries[h.cursor] = next;
  } else {
    h.entries.push(next);
    if (h.entries.length > LIMIT) h.entries.shift();
    h.cursor = h.entries.length - 1;
  }
  h.key = coalesceKey;
};

/** Move the cursor by `delta` and return the snapshot there, or undefined at the ends. */
export const step = (h: History, delta: number): Snapshot | undefined => {
  const snapshot = h.entries[h.cursor + delta];
  if (!snapshot) return undefined;
  h.cursor += delta;
  h.key = null; // a jump closes any open gesture
  return snapshot;
};

export const canUndo = (h: History): boolean => h.cursor > 0;
export const canRedo = (h: History): boolean => h.cursor < h.entries.length - 1;

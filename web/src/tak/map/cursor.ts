import { useSyncExternalStore } from "react";
import type { Position } from "../cot.ts";

/**
 * Where the pointer is on one map. A store, not React state, so a mouse move
 * re-renders only what shows the coordinate, not the whole workspace.
 */
export type Cursor = {
  get: () => Position | undefined;
  set: (position: Position | undefined) => void;
  subscribe: (listener: () => void) => () => void;
};

export const createCursor = (): Cursor => {
  let position: Position | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => position,
    set: (next) => {
      position = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const useCursor = (cursor: Cursor): Position | undefined =>
  useSyncExternalStore(cursor.subscribe, cursor.get);

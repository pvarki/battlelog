import { useSyncExternalStore } from "react";
import type { Position } from "../cot.ts";

/**
 * Where the pointer is on the map. Kept out of React state so a mouse move
 * re-renders only what shows the coordinate, not the whole workspace.
 */
let cursor: Position | undefined;
const listeners = new Set<() => void>();

export const setCursor = (position: Position | undefined) => {
  cursor = position;
  for (const listener of listeners) listener();
};

export const useCursor = (): Position | undefined =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => cursor,
  );

import type { TakChange, TakItem } from "../cot.ts";
import { createTakStore, DAY_MS } from "../store.ts";
import type { TrackPoint } from "../tracks.ts";

/** Past changes to the TAK picture, and the picture as it stood at any moment of them. */

/**
 * Parsed changes kept in memory, roughly 1–2 kB each with their CoT. Past it
 * the oldest go, and replay starts later than asked.
 */
export const REPLAY_MAX_CHANGES = 100_000;

export const changeTime = (change: TakChange) =>
  change.kind === "upsert" ? change.item.time : change.time;

/** [start, end] as the windows of at most 24 h that TAK's archive answers, newest first. */
export const archiveChunks = (start: number, end: number): [number, number][] => {
  const chunks: [number, number][] = [];
  for (let to = end; to > start; to -= DAY_MS) chunks.push([Math.max(to - DAY_MS, start), to]);
  return chunks;
};

const changeKey = (change: TakChange) =>
  `${change.kind}:${change.kind === "upsert" ? change.item.uid : change.uid}:${changeTime(change)}`;

/** Both lists as one in time order, without the repeats overlapping windows bring, keeping the newest `max`. */
export const mergeChanges = (
  known: TakChange[],
  added: TakChange[],
  max = REPLAY_MAX_CHANGES,
): TakChange[] => {
  const seen = new Set<string>();
  const merged = known.concat(added).filter((change) => {
    const key = changeKey(change);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return merged.sort((a, b) => changeTime(a) - changeTime(b)).slice(-max);
};

export type ReplayFrame = {
  at: number;
  items: TakItem[];
  tracks: ReadonlyMap<string, TrackPoint[]>;
};

/**
 * The picture at any moment from `changes` (in time order) on top of `seed`,
 * items unchanged since before the first of them. The live store does the
 * reducing, so replay follows its newest-wins, tombstone and track rules.
 * Moving forward applies only what's new; moving back starts over.
 */
export const createReplay = (changes: TakChange[], seed: TakItem[]) => {
  const seedRecords = seed.map((item) => ({ uid: item.uid, item }));
  let store = createTakStore();
  let applied = 0;
  let current = Number.POSITIVE_INFINITY;

  return {
    at: (at: number): ReplayFrame => {
      if (at < current) {
        store = createTakStore();
        store.restore(seedRecords, at);
        applied = 0;
      }
      current = at;
      for (; applied < changes.length; applied++) {
        const change = changes[applied] as TakChange;
        if (changeTime(change) > at) break;
        store.apply(change);
      }
      store.sweep(at);
      store.flush();
      store.takeDirty();
      return { at, items: store.getSnapshot(), tracks: store.getTracks() };
    },
  };
};

export type Replay = ReturnType<typeof createReplay>;

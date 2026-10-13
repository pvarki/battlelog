import type { TakChange, TakItem } from "./cot.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The current TAK picture, keyed by CoT uid. The live stream and the archive
 * backfill arrive in any order, so the newest `time` wins, and deletes leave a
 * tombstone that stops an older replayed copy from resurrecting the item.
 *
 * Changes apply at once but listeners hear about them at most every
 * `notifyDelayMs`: drone telemetry alone is several updates a second, and
 * neither the map nor React needs to redraw that often.
 */
export const createTakStore = ({
  maxItems = 20_000,
  staleGraceMs = DAY_MS,
  /** Delete/offline marks must outlive the archive replay, or a reconnect resurrects deleted items. */
  markRetentionMs = 8 * DAY_MS,
  notifyDelayMs = 250,
}: {
  maxItems?: number;
  staleGraceMs?: number;
  markRetentionMs?: number;
  notifyDelayMs?: number;
} = {}) => {
  const items = new Map<string, TakItem>();
  const tombstones = new Map<string, number>();
  const disconnects = new Map<string, number>();
  const listeners = new Set<() => void>();
  let snapshot: TakItem[] = [];
  let notifyTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(notifyTimer);
    notifyTimer = undefined;
    snapshot = [...items.values()];
    for (const listener of listeners) listener();
  };

  const changed = () => {
    notifyTimer ??= setTimeout(flush, notifyDelayMs);
  };

  // ponytail: O(n) scan per overflow; fine at the cap, index by time if eviction becomes routine.
  const evictOldest = () => {
    let oldest: TakItem | undefined;
    for (const item of items.values()) {
      if (!oldest || item.time < oldest.time) oldest = item;
    }
    if (oldest) items.delete(oldest.uid);
  };

  const apply = (change: TakChange) => {
    if (change.kind === "offline") {
      disconnects.set(change.uid, Math.max(change.time, disconnects.get(change.uid) ?? 0));
      const current = items.get(change.uid);
      if (current && !current.offline && current.time <= change.time) {
        items.set(change.uid, { ...current, offline: true });
        changed();
      }
      return;
    }
    if (change.kind === "delete") {
      tombstones.set(change.uid, Math.max(change.time, tombstones.get(change.uid) ?? 0));
      const current = items.get(change.uid);
      if (current && current.time <= change.time) {
        items.delete(change.uid);
        changed();
      }
      return;
    }
    const { item } = change;
    if ((tombstones.get(item.uid) ?? Number.NEGATIVE_INFINITY) >= item.time) return;
    const current = items.get(item.uid);
    if (current && current.time >= item.time) return;
    const offline = (disconnects.get(item.uid) ?? Number.NEGATIVE_INFINITY) >= item.time;
    items.set(item.uid, offline ? { ...item, offline: true } : item);
    if (items.size > maxItems) evictOldest();
    changed();
  };

  /** Stale items stay (shown greyed) for a grace period, then go. */
  const sweep = (now = Date.now()) => {
    for (const item of items.values()) {
      if (item.stale + staleGraceMs < now) {
        items.delete(item.uid);
        changed();
      }
    }
    for (const marks of [tombstones, disconnects]) {
      for (const [uid, at] of marks) {
        if (at + markRetentionMs < now) marks.delete(uid);
      }
    }
  };

  return {
    apply,
    sweep,
    /** Delivers pending changes now instead of at the next notify tick. */
    flush,
    get: (uid: string) => items.get(uid),
    /** Stable between notifications, as `useSyncExternalStore` requires. */
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export type TakStore = ReturnType<typeof createTakStore>;

import type { TakChange, TakItem } from "./cot.ts";
import { mergeTrack, type TrackPoint } from "./tracks.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The current TAK picture, keyed by CoT uid. The live stream and the archive
 * backfill arrive in any order, so the newest `time` wins, and deletes leave a
 * tombstone that stops an older replayed copy from resurrecting the item.
 *
 * Changes apply at once but listeners hear about them at most every
 * `notifyDelayMs`: drone telemetry alone is several updates a second, and
 * neither the map nor React needs to redraw that often.
 *
 * Items that move also get a track: their recent positions, bounded by
 * `mergeTrack`.
 *
 * Every uid whose item, marks or track changed is remembered until
 * `takeDirty`, so the picture can be saved without listening to React's
 * notifications: mark-only changes never notify.
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
  const tracks = new Map<string, TrackPoint[]>();
  const listeners = new Set<() => void>();
  let snapshot: TakItem[] = [];
  let tracksSnapshot: ReadonlyMap<string, TrackPoint[]> = new Map();
  let notifyTimer: ReturnType<typeof setTimeout> | undefined;
  const dirty = new Set<string>();

  const flush = () => {
    clearTimeout(notifyTimer);
    notifyTimer = undefined;
    snapshot = [...items.values()];
    tracksSnapshot = new Map(tracks);
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
    if (oldest) {
      dirty.add(oldest.uid);
      items.delete(oldest.uid);
      tracks.delete(oldest.uid);
    }
  };

  const addToTrack = (uid: string, points: TrackPoint[], now: number) => {
    const before = tracks.get(uid);
    const track = mergeTrack(before ?? [], points, now);
    if (track.length !== (before?.length ?? 0) || track.at(-1) !== before?.at(-1)) dirty.add(uid);
    if (track.length) tracks.set(uid, track);
    else tracks.delete(uid);
  };

  const apply = (change: TakChange) => {
    if (change.kind !== "upsert") dirty.add(change.uid);
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
        tracks.delete(change.uid);
        changed();
      }
      return;
    }
    const { item } = change;
    if ((tombstones.get(item.uid) ?? Number.NEGATIVE_INFINITY) >= item.time) return;
    const current = items.get(item.uid);
    if (current && current.time >= item.time) return;
    if (current?.geometry.type === "Point" && item.geometry.type === "Point" && !item.ellipse) {
      const [from, to] = [current.geometry.coordinates, item.geometry.coordinates];
      if (tracks.has(item.uid) || from[0] !== to[0] || from[1] !== to[1]) {
        addToTrack(
          item.uid,
          [
            { position: from, time: current.time },
            { position: to, time: item.time },
          ],
          item.time,
        );
      }
    }
    const offline = (disconnects.get(item.uid) ?? Number.NEGATIVE_INFINITY) >= item.time;
    dirty.add(item.uid);
    items.set(item.uid, offline ? { ...item, offline: true } : item);
    if (items.size > maxItems) evictOldest();
    changed();
  };

  /** Stale items stay (shown greyed) for a grace period, then go. */
  const sweep = (now = Date.now()) => {
    for (const item of items.values()) {
      if (item.stale + staleGraceMs < now) {
        dirty.add(item.uid);
        items.delete(item.uid);
        tracks.delete(item.uid);
        changed();
      }
    }
    const hadTracks = tracks.size > 0;
    for (const uid of tracks.keys()) addToTrack(uid, [], now);
    if (hadTracks) changed();
    for (const marks of [tombstones, disconnects]) {
      for (const [uid, at] of marks) {
        if (at + markRetentionMs < now) {
          marks.delete(uid);
          dirty.add(uid);
        }
      }
    }
  };

  /** Everything kept about `uid`, or undefined when nothing is. */
  const recordOf = (uid: string): StoredUid | undefined => {
    const record: StoredUid = {
      uid,
      item: items.get(uid),
      tombstone: tombstones.get(uid),
      disconnect: disconnects.get(uid),
      track: tracks.get(uid),
    };
    const kept = record.item || record.tombstone || record.disconnect || record.track;
    return kept ? record : undefined;
  };

  /** Puts back a saved picture. Newer state already here wins, and nothing restored counts as dirty. */
  const restore = (records: StoredUid[], now = Date.now()) => {
    for (const { uid, item, tombstone, disconnect, track } of records) {
      if (tombstone) tombstones.set(uid, Math.max(tombstone, tombstones.get(uid) ?? 0));
      if (disconnect) disconnects.set(uid, Math.max(disconnect, disconnects.get(uid) ?? 0));
      if (item && !((items.get(uid)?.time ?? Number.NEGATIVE_INFINITY) >= item.time))
        items.set(uid, item);
      if (track && !tracks.has(uid)) tracks.set(uid, track);
    }
    while (items.size > maxItems) evictOldest();
    sweep(now);
    changed();
  };

  return {
    apply,
    sweep,
    restore,
    recordOf,
    /** The uids changed since the last call; the caller saves them or hands them back with `markDirty`. */
    takeDirty: (): string[] => {
      const uids = [...dirty];
      dirty.clear();
      return uids;
    },
    /** Everything the store keeps counts as changed, so the next save writes the whole picture. */
    markAllDirty: () => {
      for (const marks of [items, tombstones, disconnects, tracks]) {
        for (const uid of marks.keys()) dirty.add(uid);
      }
    },
    markDirty: (uids: string[]) => {
      for (const uid of uids) dirty.add(uid);
    },
    /** Earlier positions of `uid`, e.g. from TAK's history of it. */
    addTrack: (uid: string, points: TrackPoint[]) => {
      addToTrack(uid, points, Date.now());
      changed();
    },
    /** Delivers pending changes now instead of at the next notify tick. */
    flush,
    get: (uid: string) => items.get(uid),
    /** When `uid` was last deleted, if it was. */
    deletedAt: (uid: string) => tombstones.get(uid),
    /** Stable between notifications, as `useSyncExternalStore` requires. */
    getSnapshot: () => snapshot,
    /** Tracks by uid, stable between notifications. */
    getTracks: () => tracksSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export type TakStore = ReturnType<typeof createTakStore>;

/** What the store keeps about one uid, as saved between visits. */
export type StoredUid = {
  uid: string;
  item?: TakItem;
  tombstone?: number;
  disconnect?: number;
  track?: TrackPoint[];
};

import "varlock/auto-load";
import { ENV } from "varlock/env";
import { logger } from "../../lib/logger.ts";
import type { CotChange, TakFeature } from "./cot.ts";

export type TakMission = {
  name: string;
  description?: string;
  creatorUid?: string;
  createTime?: string;
  keywords: string[];
  items: TakFeature[];
};

/** Mission metadata from `GET /Marti/api/missions`; contents are fetched separately. */
export const parseMissionList = (json: string): Omit<TakMission, "items">[] => {
  if (!json) return [];
  const data: unknown = JSON.parse(json)?.data;
  if (!Array.isArray(data)) return [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return data.flatMap((m) => {
    const name = str(m?.name);
    if (!name) return [];
    return [
      {
        name,
        description: str(m.description),
        creatorUid: str(m.creatorUid),
        createTime: str(m.createTime),
        keywords: Array.isArray(m.keywords)
          ? m.keywords.filter((k: unknown) => typeof k === "string")
          : [],
      },
    ];
  });
};

export type TakStateChange =
  | { kind: "upsert"; feature: TakFeature }
  | { kind: "delete"; id: string }
  | { kind: "missions"; missions: TakMission[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Current TAK map picture, keyed by CoT uid. Live stream and archive backfill
 * arrive in any order, so the newest `time` wins and deletes leave a tombstone
 * that stops an older replayed copy from resurrecting the item.
 */
export const createTakState = ({
  maxItems = 20_000,
  staleGraceMs = DAY_MS,
  /** Delete/offline marks must outlive the archive replay, or a reconnect resurrects deleted items. */
  markRetentionMs = 8 * DAY_MS,
} = {}) => {
  const items = new Map<string, TakFeature>();
  const tombstones = new Map<string, number>();
  const disconnects = new Map<string, number>();
  const listeners = new Set<(change: TakStateChange) => void>();
  let missions: TakMission[] = [];

  const emit = (change: TakStateChange) => {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch (err) {
        logger.error({ err }, "tak state subscriber threw");
      }
    }
  };

  const remove = (id: string) => {
    if (items.delete(id)) emit({ kind: "delete", id });
  };

  // ponytail: O(n) scan per overflow; fine at the cap, index by time if eviction becomes routine.
  const evictOldest = () => {
    let oldest: TakFeature | undefined;
    for (const f of items.values()) {
      if (!oldest || Date.parse(f.properties.time) < Date.parse(oldest.properties.time)) oldest = f;
    }
    if (!oldest) return;
    logger.warn({ id: oldest.id, maxItems }, "tak state full, evicting oldest item");
    remove(oldest.id);
  };

  const put = (feature: TakFeature) => {
    items.set(feature.id, feature);
    emit({ kind: "upsert", feature });
  };

  const markOffline = (f: TakFeature): TakFeature => ({
    ...f,
    properties: { ...f.properties, offline: true },
  });

  const apply = (change: CotChange) => {
    if (change.kind === "offline") {
      const at = Date.parse(change.time);
      disconnects.set(change.uid, Math.max(at, disconnects.get(change.uid) ?? 0));
      const current = items.get(change.uid);
      if (current && !current.properties.offline && Date.parse(current.properties.time) <= at) {
        put(markOffline(current));
      }
      return;
    }
    if (change.kind === "delete") {
      const at = Date.parse(change.time);
      tombstones.set(change.uid, Math.max(at, tombstones.get(change.uid) ?? 0));
      const current = items.get(change.uid);
      if (current && Date.parse(current.properties.time) <= at) remove(change.uid);
      return;
    }
    const { feature } = change;
    const at = Date.parse(feature.properties.time);
    if ((tombstones.get(feature.id) ?? Number.NEGATIVE_INFINITY) >= at) return;
    const current = items.get(feature.id);
    if (current && Date.parse(current.properties.time) >= at) return;
    const offline = (disconnects.get(feature.id) ?? Number.NEGATIVE_INFINITY) >= at;
    put(offline ? markOffline(feature) : feature);
    if (items.size > maxItems) evictOldest();
  };

  /** Stale items stay (shown greyed) for a grace period, then go. */
  const sweep = (now = Date.now()) => {
    for (const f of [...items.values()]) {
      if (Date.parse(f.properties.stale) + staleGraceMs < now) remove(f.id);
    }
    for (const marks of [tombstones, disconnects]) {
      for (const [uid, at] of marks) {
        if (at + markRetentionMs < now) marks.delete(uid);
      }
    }
  };

  /** Replaces the mission list; subscribers hear only actual changes. */
  const setMissions = (next: TakMission[]) => {
    if (JSON.stringify(next) === JSON.stringify(missions)) return;
    missions = next;
    emit({ kind: "missions", missions });
  };

  return {
    apply,
    sweep,
    setMissions,
    missions: () => missions,
    snapshot: () => [...items.values()],
    onChange: (listener: (change: TakStateChange) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export type TakState = ReturnType<typeof createTakState>;

/** Process-wide TAK picture, fed by the TAK client and read by the API. */
export const takState = createTakState({ markRetentionMs: (ENV.TAK_BACKFILL_DAYS + 1) * DAY_MS });

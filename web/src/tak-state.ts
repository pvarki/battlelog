import { useSyncExternalStore } from "react";
import type { TakFeature, TakMission } from "./api.ts";
import type { ConnectionState } from "./live-events.ts";

export type TakView = {
  /** `null` until the first snapshot; `false` when the server has no TAK configured. */
  enabled: boolean | null;
  items: TakFeature[];
  /** TAK missions (Data Sync feeds) with their contents; refreshed by the server every 30 s. */
  missions: TakMission[];
  /** False until the server has polled missions once; until then `missions` proves nothing. */
  missionsLoaded: boolean;
  connection: ConnectionState;
};

// Same liveness rule as the events stream: the server pings every 15s.
const PING_TIMEOUT_MS = 35_000;
const REOPEN_DELAY_MS = 5_000;
// Drone telemetry alone is several updates a second; render at most this often.
const NOTIFY_DELAY_MS = 250;

const items = new Map<string, TakFeature>();
const listeners = new Set<() => void>();
const INITIAL: TakView = {
  enabled: null,
  items: [],
  missions: [],
  missionsLoaded: false,
  connection: "connecting",
};
let view = INITIAL;
let source: EventSource | undefined;
let pingTimer: ReturnType<typeof setTimeout> | undefined;
let reopenTimer: ReturnType<typeof setTimeout> | undefined;
let notifyTimer: ReturnType<typeof setTimeout> | undefined;

const publish = (patch: Partial<TakView>) => {
  view = { ...view, ...patch };
  for (const l of listeners) l();
};

const scheduleItems = () => {
  notifyTimer ??= setTimeout(() => {
    notifyTimer = undefined;
    publish({ items: [...items.values()] });
  }, NOTIFY_DELAY_MS);
};

// Armed from the moment a connection starts, so one that opens but never
// delivers anything is also torn down and reopened.
const armWatchdog = () => {
  clearTimeout(pingTimer);
  pingTimer = setTimeout(() => {
    publish({ connection: "connecting" });
    open();
  }, PING_TIMEOUT_MS);
};

const heardFromServer = () => {
  if (view.connection !== "live") publish({ connection: "live" });
  armWatchdog();
};

// One stream per tab, shared by every map widget. Each (re)connect starts with
// a full snapshot, so there is no cursor to resume from.
const open = () => {
  clearTimeout(reopenTimer);
  source?.close();
  const es = new EventSource("/api/v1/tak/stream");
  source = es;
  armWatchdog();
  es.addEventListener("open", armWatchdog);
  es.addEventListener("ping", heardFromServer);
  es.addEventListener("snapshot", (e) => {
    heardFromServer();
    const snapshot = JSON.parse(e.data) as { enabled: boolean; items: TakFeature[] };
    items.clear();
    for (const f of snapshot.items) items.set(f.id, f);
    clearTimeout(notifyTimer);
    notifyTimer = undefined;
    publish({ enabled: snapshot.enabled, items: [...items.values()] });
  });
  es.addEventListener("upsert", (e) => {
    heardFromServer();
    const f = JSON.parse(e.data) as TakFeature;
    items.set(f.id, f);
    scheduleItems();
  });
  es.addEventListener("delete", (e) => {
    heardFromServer();
    items.delete((JSON.parse(e.data) as { id: string }).id);
    scheduleItems();
  });
  es.addEventListener("missions", (e) => {
    heardFromServer();
    publish({ missions: JSON.parse(e.data) as TakMission[], missionsLoaded: true });
  });
  es.addEventListener("error", () => {
    if (es.readyState === EventSource.CLOSED) {
      clearTimeout(pingTimer);
      publish({ connection: "down" });
      reopenTimer = setTimeout(open, REOPEN_DELAY_MS);
    } else {
      publish({ connection: "connecting" });
    }
  });
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!source) open();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearTimeout(pingTimer);
    clearTimeout(reopenTimer);
    clearTimeout(notifyTimer);
    notifyTimer = undefined;
    source?.close();
    source = undefined;
    items.clear();
    view = INITIAL;
  };
};

/** Live TAK map picture. Holds the shared stream open while mounted. */
export const useTakState = (): TakView => useSyncExternalStore(subscribe, () => view);

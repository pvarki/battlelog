import { useSyncExternalStore } from "react";
import type { TakFeature, TakMission } from "./api.ts";
import type { ConnectionState } from "./live-events.ts";

export type TakView = {
  /** `null` until the first snapshot; `false` when the server has no TAK configured. */
  enabled: boolean | null;
  items: TakFeature[];
  /** TAK missions (Data Sync feeds) with their contents; refreshed every 30 s. */
  missions: TakMission[];
  /** False until missions have been polled once; until then `missions` proves nothing. */
  missionsLoaded: boolean;
  connection: ConnectionState;
};

/** Where a TAK source delivers the picture; the store turns it into a `TakView`. */
export type TakSink = {
  reset(enabled: boolean, items: TakFeature[]): void;
  upsert(feature: TakFeature): void;
  remove(id: string): void;
  missions(missions: TakMission[]): void;
  connection(state: ConnectionState): void;
};

/** Starts feeding `sink`; returns the stop function. */
export type TakSource = (sink: TakSink) => () => void;

// Same liveness rule as the events stream: the server pings every 15s.
const PING_TIMEOUT_MS = 35_000;
const REOPEN_DELAY_MS = 5_000;
// Drone telemetry alone is several updates a second; render at most this often.
const NOTIFY_DELAY_MS = 250;

/** BattleLog's server holds the TAK connection and streams the picture over SSE. */
const battlelogSource: TakSource = (sink) => {
  let source: EventSource | undefined;
  let pingTimer: ReturnType<typeof setTimeout> | undefined;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;

  // Armed from the moment a connection starts, so one that opens but never
  // delivers anything is also torn down and reopened.
  const armWatchdog = () => {
    clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {
      sink.connection("connecting");
      open();
    }, PING_TIMEOUT_MS);
  };

  const heardFromServer = () => {
    sink.connection("live");
    armWatchdog();
  };

  // Each (re)connect starts with a full snapshot, so there is no cursor to resume from.
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
      sink.reset(snapshot.enabled, snapshot.items);
    });
    es.addEventListener("upsert", (e) => {
      heardFromServer();
      sink.upsert(JSON.parse(e.data) as TakFeature);
    });
    es.addEventListener("delete", (e) => {
      heardFromServer();
      sink.remove((JSON.parse(e.data) as { id: string }).id);
    });
    es.addEventListener("missions", (e) => {
      heardFromServer();
      sink.missions(JSON.parse(e.data) as TakMission[]);
    });
    es.addEventListener("error", () => {
      if (es.readyState === EventSource.CLOSED) {
        clearTimeout(pingTimer);
        sink.connection("down");
        reopenTimer = setTimeout(open, REOPEN_DELAY_MS);
      } else {
        sink.connection("connecting");
      }
    });
  };

  open();
  return () => {
    clearTimeout(pingTimer);
    clearTimeout(reopenTimer);
    source?.close();
  };
};

/**
 * Local testing of the future same-origin deployment: the browser talks to TAK
 * itself through the dev server's `/tak` proxy (see vite.config.ts). Loaded on
 * demand so the TAK parser stays out of the normal bundle.
 */
const directSource: TakSource = (sink) => {
  let stop: (() => void) | undefined;
  let stopped = false;
  void import("./tak-direct.ts").then(({ startDirectTak }) => {
    if (!stopped) stop = startDirectTak(sink);
  });
  return () => {
    stopped = true;
    stop?.();
  };
};

const source: TakSource = import.meta.env.VITE_TAK_DIRECT ? directSource : battlelogSource;

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
let stopSource: (() => void) | undefined;
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

const sink: TakSink = {
  reset(enabled, next) {
    items.clear();
    for (const f of next) items.set(f.id, f);
    clearTimeout(notifyTimer);
    notifyTimer = undefined;
    publish({ enabled, items: [...items.values()] });
  },
  upsert(feature) {
    items.set(feature.id, feature);
    scheduleItems();
  },
  remove(id) {
    items.delete(id);
    scheduleItems();
  },
  missions(missions) {
    publish({ missions, missionsLoaded: true });
  },
  connection(state) {
    if (view.connection !== state) publish({ connection: state });
  },
};

// One source per tab, shared by every map widget.
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  stopSource ??= source(sink);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearTimeout(notifyTimer);
    notifyTimer = undefined;
    stopSource?.();
    stopSource = undefined;
    items.clear();
    view = INITIAL;
  };
};

/** Live TAK map picture. Holds the shared source open while mounted. */
export const useTakState = (): TakView => useSyncExternalStore(subscribe, () => view);

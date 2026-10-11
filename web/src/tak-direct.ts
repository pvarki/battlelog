import { parseCot } from "@server/services/tak/cot.ts";
import { consoleLog, createTakState, DAY_MS } from "@server/services/tak/tak.state.ts";
import { backfill, type GetText, pollMissions } from "@server/services/tak/tak.sync.ts";
import { takprotoToCot } from "./tak-proto.ts";
import type { TakSink } from "./tak-state.ts";

// Where TAK appears on this origin: the dev proxy today, Kubernetes path routing later.
const TAK_BASE = import.meta.env.VITE_TAK_BASE ?? "/tak";
const BACKFILL_DAYS = 7;
const RECONNECT_DELAY_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

const getText: GetText = async (path) => {
  const res = await fetch(`${TAK_BASE}${path}`);
  if (res.status === 404) return "";
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
};

const websocketUrl = () => {
  const url = new URL(`${TAK_BASE}/takproto/1`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
};

/** The browser-side twin of the server's TAK client: same state rules, TAK's own transports. */
export const startDirectTak = (sink: TakSink): (() => void) => {
  const state = createTakState({ markRetentionMs: (BACKFILL_DAYS + 1) * DAY_MS });
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  sink.reset(true, []);
  const unsubscribe = state.onChange((change) => {
    if (change.kind === "upsert") sink.upsert(change.feature);
    else if (change.kind === "delete") sink.remove(change.id);
    else sink.missions(change.missions);
  });
  const stopMissions = pollMissions(getText, state, consoleLog);
  const sweeper = setInterval(() => state.sweep(), SWEEP_INTERVAL_MS);

  const connect = () => {
    const current = ++generation;
    const isCurrent = () => !stopped && current === generation;
    const ws = new WebSocket(websocketUrl());
    ws.binaryType = "arraybuffer";
    socket = ws;
    sink.connection("connecting");
    ws.onopen = () => {
      sink.connection("live");
      void backfill({ getText, state, days: BACKFILL_DAYS, isCurrent, log: consoleLog });
    };
    ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const { events, error } = takprotoToCot(new Uint8Array(e.data));
      if (error) consoleLog.warn({ err: error }, "tak websocket message unreadable");
      for (const xml of events) {
        const change = parseCot(xml);
        if (change) state.apply(change);
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      sink.connection("down");
      retry = setTimeout(connect, RECONNECT_DELAY_MS);
    };
  };

  connect();
  return () => {
    stopped = true;
    unsubscribe();
    stopMissions();
    clearInterval(sweeper);
    clearTimeout(retry);
    socket?.close();
  };
};

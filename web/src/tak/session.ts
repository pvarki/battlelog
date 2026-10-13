import { useEffect, useSyncExternalStore } from "react";
import { type CotEvent, toChange } from "./cot.ts";
import { decodeTakMessages, encodeTakMessage } from "./protocol/takproto.ts";
import { fetchArchive, fetchHistory, takBaseUrl } from "./rest.ts";
import { createTakStore, DAY_MS } from "./store.ts";
import { TRACK_MAX_AGE_MS, trackPointOf } from "./tracks.ts";

/**
 * The one TAK connection per tab: the `/takproto/1` WebSocket for live CoT in
 * both directions, plus an archive backfill on every (re)connect so items
 * placed while we were away still show. It runs only while something holds it
 * (`useTakSession`), and every holder shares the same store.
 */

export type TakConnection = "idle" | "connecting" | "live" | "down";

export type TakStatus = {
  connection: TakConnection;
  /** False until the first connect succeeds: a "down" before that is more likely a certificate or address problem than an outage. */
  everConnected: boolean;
  /** Epoch ms of the last message from TAK. */
  lastMessageAt?: number;
  /** Archive days still to load after a connect; 0 when done. */
  backfillDaysLeft: number;
};

const BACKFILL_DAYS = 7;
const RECONNECT_DELAY_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

export const takStore = createTakStore({ markRetentionMs: (BACKFILL_DAYS + 1) * DAY_MS });

let status: TakStatus = { connection: "idle", everConnected: false, backfillDaysLeft: 0 };
const statusListeners = new Set<() => void>();

const setStatus = (patch: Partial<TakStatus>) => {
  status = { ...status, ...patch };
  for (const listener of statusListeners) listener();
};

let holders = 0;
let socket: WebSocket | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let sweepTimer: ReturnType<typeof setInterval> | undefined;
let backfillAbort: AbortController | undefined;

const applyEvent = (event: CotEvent) => {
  const change = toChange(event);
  if (change) takStore.apply(change);
};

/** TAK caps archive queries at 24 h, so long-lived items need one query per day. */
const backfill = async (signal: AbortSignal) => {
  const now = Date.now();
  for (let day = BACKFILL_DAYS; day > 0 && !signal.aborted; day--) {
    setStatus({ backfillDaysLeft: day });
    try {
      const events = await fetchArchive(
        new Date(now - day * DAY_MS),
        new Date(now - (day - 1) * DAY_MS),
        signal,
      );
      if (!signal.aborted) events.forEach(applyEvent);
    } catch (err) {
      if (!signal.aborted) console.warn("TAK backfill window failed", err);
    }
  }
  if (!signal.aborted) setStatus({ backfillDaysLeft: 0 });
};

const websocketUrl = () => {
  const url = new URL(`${takBaseUrl()}/takproto/1`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
};

const connect = () => {
  const ws = new WebSocket(websocketUrl());
  ws.binaryType = "arraybuffer";
  socket = ws;
  setStatus({ connection: "connecting" });
  ws.onopen = () => {
    setStatus({ connection: "live", everConnected: true, lastMessageAt: Date.now() });
    backfillAbort?.abort();
    backfillAbort = new AbortController();
    void backfill(backfillAbort.signal);
  };
  ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    const { events, error } = decodeTakMessages(new Uint8Array(e.data));
    if (error) console.warn("TAK message unreadable", error);
    events.forEach(applyEvent);
    setStatus({ lastMessageAt: Date.now() });
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    backfillAbort?.abort();
    setStatus({ connection: "down", backfillDaysLeft: 0 });
    retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  };
};

const start = () => {
  connect();
  sweepTimer = setInterval(() => takStore.sweep(), SWEEP_INTERVAL_MS);
};

const stop = () => {
  const ws = socket;
  socket = undefined;
  ws?.close();
  backfillAbort?.abort();
  clearTimeout(retryTimer);
  clearInterval(sweepTimer);
  setStatus({ connection: "idle", backfillDaysLeft: 0 });
};

/** Keeps the TAK connection open while the calling component is mounted. */
export const useTakSession = () => {
  useEffect(() => {
    if (holders++ === 0) start();
    return () => {
      if (--holders === 0) stop();
    };
  }, []);
};

/** Connection health; "idle" when nothing holds the session. Does not open it. */
export const useTakStatus = (): TakStatus =>
  useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    () => status,
  );

export const useTakItems = () => useSyncExternalStore(takStore.subscribe, takStore.getSnapshot);

export const useTakTracks = () => useSyncExternalStore(takStore.subscribe, takStore.getTracks);

/** Fills in where `uid` was before this page saw it move, from TAK's stored history. */
export const loadTrack = async (uid: string) => {
  try {
    const events = await fetchHistory(uid, TRACK_MAX_AGE_MS / 1000);
    takStore.addTrack(uid, events.map(trackPointOf));
  } catch (err) {
    console.warn("TAK track history unavailable", err);
  }
};

/**
 * Sends one CoT event to TAK. True means it left this browser, not that TAK
 * accepted it: TAK doesn't echo a sender's own events back.
 */
export const sendCot = (event: CotEvent): boolean => {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(encodeTakMessage(event));
  applyEvent(event);
  return true;
};

import { useEffect, useSyncExternalStore } from "react";
import { receiveChat, restoreChat } from "./chat/store.ts";
import { type CotEvent, toChange } from "./cot.ts";
import { receiveFileShare } from "./inbox/store.ts";
import { receiveMissionChange } from "./missions/store.ts";
import {
  currentScope,
  forgetPicture,
  forgetSavedPictures,
  loadPicture,
  savePicture,
  savingEnabled,
} from "./picture-cache.ts";
import { newPresenceEvent, SELF_TYPE, type SelfIdentity } from "./position/self-sa.ts";
import { decodeTakMessages, encodeTakMessage } from "./protocol/takproto.ts";
import { fetchArchive, fetchHistory, takBaseUrl } from "./rest.ts";
import { createTakStore, DAY_MS } from "./store.ts";
import { TRACK_MAX_AGE_MS, trackPointOf } from "./tracks.ts";

/**
 * The one TAK connection per tab: the `/takproto/1` WebSocket for live CoT in
 * both directions, plus an archive backfill on every (re)connect so items
 * placed while we were away still show. It runs only while something holds it
 * (`useTakSession`), and every holder shares the same store.
 *
 * The picture is saved in this browser (`picture-cache.ts`): a visit starts
 * from it and backfills only from where the last one got to.
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
  /** A history window failed to load; the gap is fetched again on the next connect. */
  historyFailed: boolean;
  /** How far TAK's history was fetched when the saved picture shown was stored. */
  savedThrough?: number;
};

const BACKFILL_DAYS = 7;
// Events stored just before the last sync can reach the archive a little late.
const SYNC_OVERLAP_MS = 5 * 60_000;
const SAVE_INTERVAL_MS = 1_000;
// Well inside a report's two-minute stale time, so the user never greys out on TAK.
const PRESENCE_INTERVAL_MS = 60_000;
const RECONNECT_DELAY_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

export const takStore = createTakStore({ markRetentionMs: (BACKFILL_DAYS + 1) * DAY_MS });

let status: TakStatus = {
  connection: "idle",
  everConnected: false,
  backfillDaysLeft: 0,
  historyFailed: false,
};
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
let saveTimer: ReturnType<typeof setInterval> | undefined;
/** Where the saved picture lives; undefined while it isn't being saved. */
let scope: string | undefined;
/** TAK's history is in the store up to here; the next backfill starts from it. */
let syncedThrough: number | undefined;
let presence: SelfIdentity | undefined;
/** The latest report with a real position, while the user shares it. */
let positionReport: CotEvent | undefined;
let lastReportAt = 0;
let presenceTimer: ReturnType<typeof setInterval> | undefined;
let restored: Promise<void> | undefined;
let saving: Promise<void> = Promise.resolve();
/** This tab writes the saved picture; other tabs keep theirs in memory only. */
let writer = false;
let claimed = false;

const applyEvent = (event: CotEvent) => {
  if (receiveChat(event)) return;
  const change = toChange(event);
  if (change) takStore.apply(change);
};

/** Saves what changed, and with `through` how far the history now reaches. Saves run one at a time. */
const save = (through?: number): Promise<void> => {
  saving = saving.then(async () => {
    const uids = takStore.takeDirty();
    if (!scope || !writer || !savingEnabled() || (uids.length === 0 && through === undefined))
      return;
    const changes = uids.map((uid) => ({ uid, record: takStore.recordOf(uid) }));
    try {
      await savePicture(scope, changes, through);
    } catch (err) {
      takStore.markDirty(uids);
      console.warn("Saving the TAK picture failed", err);
    }
  });
  return saving;
};

/**
 * One tab at a time writes the saved picture, so a tab that missed a delete
 * can't overwrite it. When the writer's tab closes the next one takes over,
 * saving its whole picture with how far its history reaches.
 */
const claimWriter = (lockScope: string) => {
  if (claimed) return;
  claimed = true;
  const take = async () => {
    writer = true;
    takStore.markAllDirty();
    await save(syncedThrough);
  };
  if (!navigator.locks) return void take();
  void navigator.locks.request(`battlelog-tak-picture:${lockScope}`, async () => {
    await take();
    await new Promise(() => {}); // held until this tab closes
  });
};

const openScope = async (): Promise<string | undefined> => {
  scope = await currentScope();
  return scope;
};

const restore = async () => {
  if (!savingEnabled() || !(await openScope()) || !scope) return;
  void restoreChat();
  const saved = await loadPicture(scope).catch(() => undefined);
  // Older than the history TAK can replay, deletes made since could be missed: start over.
  const catchable = (saved?.syncedThrough ?? 0) > Date.now() - BACKFILL_DAYS * DAY_MS;
  if (saved?.records.length && catchable) {
    takStore.restore(saved.records);
    takStore.flush();
    syncedThrough = saved.syncedThrough;
    setStatus({ savedThrough: saved.syncedThrough });
  } else if (saved?.records.length) {
    await forgetPicture(scope).catch(() => undefined);
  }
  claimWriter(scope);
};

/** Saving turned on writes the whole picture at once; off deletes what's saved. */
export const setPictureSaving = async (enabled: boolean) => {
  if (!enabled) {
    saving = saving.then(forgetSavedPictures).catch(() => undefined);
    return saving;
  }
  if (!scope && !(await openScope())) return;
  if (!claimed && scope) return claimWriter(scope);
  if (!writer) return;
  takStore.markAllDirty();
  return save(syncedThrough);
};

/**
 * TAK caps archive queries at 24 h, so history comes a day at a time, oldest
 * first. A window counts only once it's applied and saved; the first failure
 * stops here, so the next connect starts from the gap instead of skipping it.
 */
const backfill = async (signal: AbortSignal) => {
  const now = Date.now();
  let from = Math.max(now - BACKFILL_DAYS * DAY_MS, (syncedThrough ?? 0) - SYNC_OVERLAP_MS);
  setStatus({ historyFailed: false });
  while (from < now && !signal.aborted) {
    const to = Math.min(from + DAY_MS, now);
    setStatus({ backfillDaysLeft: Math.ceil((now - from) / DAY_MS) });
    try {
      const events = await fetchArchive(new Date(from), new Date(to), signal);
      if (signal.aborted) return;
      events.forEach(applyEvent);
      syncedThrough = to;
      await save(to);
    } catch (err) {
      if (signal.aborted) return;
      console.warn("TAK backfill window failed", err);
      setStatus({ backfillDaysLeft: 0, historyFailed: true });
      return;
    }
    from = to;
  }
  if (!signal.aborted) setStatus({ backfillDaysLeft: 0, savedThrough: undefined });
};

/**
 * Tells TAK this connection is the user: TAK routes mission updates by the uid
 * a connection reports as. Sent on connect, then whenever nothing else has
 * reported for a while; with the latest shared position, or none.
 */
const announce = (force: boolean) => {
  const now = Date.now();
  if (!presence || socket?.readyState !== WebSocket.OPEN) return;
  if (!force && now - lastReportAt < PRESENCE_INTERVAL_MS) return;
  const report = positionReport
    ? {
        ...positionReport,
        time: now,
        start: now,
        stale: now + (positionReport.stale - positionReport.time),
      }
    : newPresenceEvent(presence, navigator.platform, now);
  sendCot(report);
};

/**
 * Who this tab is on TAK, and whether it shares its position (undefined:
 * unchanged, for a map without the sharing switch). Turning sharing off sends
 * a report without a position, so the last one doesn't linger on TAK.
 */
export const setTakPresence = (self: SelfIdentity | undefined, sharing?: boolean) => {
  const known = presence?.uid === self?.uid;
  presence = self;
  const stoppedSharing = sharing === false && !!positionReport;
  if (stoppedSharing) positionReport = undefined;
  if (stoppedSharing || !known) announce(true);
};

const saveWhenHidden = () => {
  if (document.visibilityState === "hidden") void save();
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
    announce(true);
    backfillAbort?.abort();
    backfillAbort = new AbortController();
    void backfill(backfillAbort.signal);
  };
  ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    const { events, error } = decodeTakMessages(new Uint8Array(e.data));
    if (error) console.warn("TAK message unreadable", error);
    // Only live: a replayed announcement would re-offer a package already handled, and
    // a replayed mission change is already in the mission as loaded.
    for (const event of events) {
      if (!receiveFileShare(event) && !receiveMissionChange(event)) applyEvent(event);
    }
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
  restored ??= restore();
  void restored.finally(() => {
    if (holders > 0 && !socket) connect();
  });
  sweepTimer = setInterval(() => takStore.sweep(), SWEEP_INTERVAL_MS);
  saveTimer = setInterval(() => void save(), SAVE_INTERVAL_MS);
  presenceTimer = setInterval(() => announce(false), PRESENCE_INTERVAL_MS / 2);
  document.addEventListener("visibilitychange", saveWhenHidden);
};

const stop = () => {
  const ws = socket;
  socket = undefined;
  ws?.close();
  backfillAbort?.abort();
  clearTimeout(retryTimer);
  clearInterval(sweepTimer);
  clearInterval(saveTimer);
  clearInterval(presenceTimer);
  document.removeEventListener("visibilitychange", saveWhenHidden);
  void save();
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
  if (event.uid === presence?.uid && event.type === SELF_TYPE) {
    lastReportAt = Date.now();
    if (event.lat !== 0 || event.lon !== 0) positionReport = event;
  }
  applyEvent(event);
  return true;
};

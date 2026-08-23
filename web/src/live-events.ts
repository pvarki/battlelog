import type { InferRequestType } from "hono/client";
import { useEffect, useRef, useState } from "react";
import { api, type EventResponse } from "./api.ts";
import { cacheEvents, loadCachedEvents, loadCursor, saveCursor } from "./events-cache.ts";

type Listener = (row: EventResponse) => void;

/** Health of the shared event stream: `live` means rows or pings are arriving. */
export type ConnectionState = "live" | "connecting" | "down";

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  live: "Live",
  connecting: "Connecting…",
  down: "Offline",
};

// The server pings every 15s (see streamNewEvents). Silence past two pings
// means the stream is stalled even while the socket still looks open — half-open
// proxies and suspended tabs both fail that way, and readyState never notices.
const PING_TIMEOUT_MS = 35_000;
const REOPEN_DELAY_MS = 5_000;

// One EventSource per tab: browsers cap HTTP/1.1 at ~6 connections per origin,
// so every consumer multiplexes this single unfiltered stream and filters
// locally. Reconnects (with Last-Event-ID replay) are EventSource built-ins.
const listeners = new Set<Listener>();
const stateListeners = new Set<(state: ConnectionState) => void>();
let source: EventSource | undefined;
let state: ConnectionState = "connecting";
let pingTimer: ReturnType<typeof setTimeout> | undefined;
let reopenTimer: ReturnType<typeof setTimeout> | undefined;

const setState = (next: ConnectionState) => {
  if (state === next) return;
  state = next;
  for (const l of stateListeners) l(next);
};

// Any traffic proves the stream is alive. Silence arms a reconnect: a stalled
// stream that still reads as OPEN is the dangerous case — every widget keeps
// rendering last-known values and nothing looks wrong.
const heardFromServer = () => {
  setState("live");
  clearTimeout(pingTimer);
  pingTimer = setTimeout(() => {
    setState("connecting");
    open();
  }, PING_TIMEOUT_MS);
};

// Mirror stream rows in batches: a ?since= replay delivers up to REPLAY_LIMIT
// rows per connection, and one IDB transaction per batch beats one per row.
// The cursor advances only after the batch commits — a cursor past rows the
// store never got would make the server skip them on every future replay.
let pendingRows: EventResponse[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const FLUSH_DELAY_MS = 1000;
const FLUSH_MAX_ROWS = 200;

const flushRows = () => {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  const batch = pendingRows;
  pendingRows = [];
  if (batch.length === 0) return;
  // Rows arrive in ascending id order per connection, so the batch's last row
  // is its newest. (Two tabs share the key and may interleave; a rewind only
  // costs a re-replay that mergeEvents dedupes.)
  const newest = batch.at(-1);
  void cacheEvents(batch).then((stored) => {
    if (stored && newest) saveCursor(newest.id);
  });
};

const open = () => {
  clearTimeout(reopenTimer);
  source?.close();
  // Resume from the cached cursor: EventSource only sends Last-Event-ID on
  // its own reconnects, so a fresh page passes it as ?since= instead and the
  // server replays what this browser missed while closed.
  const since = loadCursor();
  const es = new EventSource(
    since ? `/api/v1/events/stream?since=${since}` : "/api/v1/events/stream",
  );
  source = es;
  es.addEventListener("open", heardFromServer);
  es.addEventListener("ping", heardFromServer);
  es.addEventListener("event", (e) => {
    heardFromServer();
    const row = JSON.parse(e.data) as EventResponse;
    pendingRows.push(row);
    if (pendingRows.length >= FLUSH_MAX_ROWS) flushRows();
    else flushTimer ??= setTimeout(flushRows, FLUSH_DELAY_MS);
    for (const l of listeners) l(row);
  });
  es.addEventListener("error", () => {
    clearTimeout(pingTimer);
    // EventSource retries transient failures itself. CLOSED means it gave up
    // (bad status, wrong content-type) and only we can bring the stream back.
    if (es.readyState === EventSource.CLOSED) {
      setState("down");
      reopenTimer = setTimeout(open, REOPEN_DELAY_MS);
    } else {
      setState("connecting");
    }
  });
};

const teardown = () => {
  flushRows();
  clearTimeout(pingTimer);
  clearTimeout(reopenTimer);
  source?.close();
  source = undefined;
  state = "connecting";
};

// The stream costs one connection, so it lives only while something watches it
// — event consumers or the header's health indicator.
const release = () => {
  if (listeners.size === 0 && stateListeners.size === 0) teardown();
};

export const subscribeToEvents = (listener: Listener): (() => void) => {
  listeners.add(listener);
  if (!source) open();
  return () => {
    listeners.delete(listener);
    release();
  };
};

/**
 * Watch stream health, holding the connection open while subscribed. The
 * listener fires immediately with the current state.
 */
export const subscribeToConnectionState = (
  listener: (state: ConnectionState) => void,
): (() => void) => {
  stateListeners.add(listener);
  if (!source) open();
  listener(state);
  return () => {
    stateListeners.delete(listener);
    release();
  };
};

/** Stream health. Holds the connection open for as long as it is mounted. */
export const useConnectionState = (): ConnectionState => {
  const [current, setCurrent] = useState(state);
  useEffect(() => subscribeToConnectionState(setCurrent), []);
  return current;
};

// Rows are versions of an append-only log: a row with the same eventId
// supersedes older ones. UUIDv7 ids sort chronologically as strings, so the
// result is newest-first like GET /events.
export const mergeEvents = (
  current: EventResponse[],
  incoming: EventResponse[],
  limit: number,
): EventResponse[] => {
  const latest = new Map<string, EventResponse>();
  for (const row of [...current, ...incoming]) {
    const seen = latest.get(row.eventId);
    if (!seen || row.id > seen.id) latest.set(row.eventId, row);
  }
  return [...latest.values()].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, limit);
};

type EventsQuery = InferRequestType<typeof api.events.$get>["query"];
type Match = (row: EventResponse) => boolean;

export type LiveEventsOptions = {
  limit?: number;
  /** Server-side filter for the initial batch. */
  query?: EventsQuery;
  /** Client-side mirror of `query`, applied to rows from the shared stream. */
  match?: Match;
};

export type LiveEvents = {
  /** Newest first. `null` until the first load settles. */
  events: EventResponse[] | null;
  /** The initial fetch failed, so an empty list means "unknown", not "none". */
  failed: boolean;
  /**
   * Row ids that arrived on the live stream rather than in the initial fetch,
   * so a view can mark what is new. Keyed by row id, not event id, so a new
   * version of an event already on screen counts as an arrival. Pruned to the
   * rows still listed, so it stays bounded by `limit`.
   */
  arrived: ReadonlySet<string>;
};

// Rows worth merging: matches, plus new versions of events already shown —
// merging those then re-filtering removes events that were updated out of the
// filter, instead of leaving a stale row frozen in the list.
export const relevantRows = (
  current: EventResponse[],
  incoming: EventResponse[],
  match: Match | undefined,
): EventResponse[] =>
  match
    ? incoming.filter((r) => match(r) || current.some((c) => c.eventId === r.eventId))
    : incoming;

// Ids to mark as newly arrived: the incoming rows plus whatever was already
// marked, minus anything no longer listed. Pruning against the rendered list is
// what bounds the set — an id dropped by `limit` or rejected by `match` never
// had a row to wash, and must not sit in the set forever.
export const markArrived = (
  previous: ReadonlySet<string>,
  incoming: EventResponse[],
  listed: EventResponse[],
): ReadonlySet<string> => {
  const shown = new Set(listed.map((r) => r.id));
  return new Set([...previous, ...incoming.map((r) => r.id)].filter((id) => shown.has(id)));
};

/** Latest events, newest first, kept live via the shared SSE stream. */
export const useLiveEvents = ({
  limit = 100,
  query,
  match,
}: LiveEventsOptions = {}): LiveEvents => {
  const [events, setEvents] = useState<EventResponse[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  // Refs so a new predicate/query identity per render doesn't restart the
  // effect; the effect re-runs only when the query's content changes.
  const matchRef = useRef(match);
  matchRef.current = match;
  const queryRef = useRef(query);
  queryRef.current = query;
  const queryKey = query === undefined ? undefined : JSON.stringify(query);

  // biome-ignore lint/correctness/useExhaustiveDependencies: query is read via ref, re-fetch keyed on its serialized content
  useEffect(() => {
    let alive = true;
    let current: EventResponse[] = [];
    const apply = (rows: EventResponse[], live = false) => {
      const m = matchRef.current;
      current = mergeEvents(current, relevantRows(current, rows, m), limit);
      if (m) current = current.filter(m);
      setEvents(current);
      if (!live) return;
      // Captured: the updater can run after a later apply() has reassigned
      // `current`, and this row set is the one being pruned against.
      const listed = current;
      setArrived((prev) => markArrived(prev, rows, listed));
    };

    setFailed(false);
    setArrived(new Set());
    // Subscribe before the fetch: merge dedupes rows that arrive on both paths.
    const unsubscribe = subscribeToEvents((row) => {
      if (alive) apply([row], true);
    });
    api.events
      .$get({ query: { ...queryRef.current, limit } })
      .then(async (res) => {
        if (!res.ok) {
          // The server answered and refused: that's an error to show, not an
          // offline moment — serving cached rows here would dress a 500 up as
          // history. Keep going live-only, as before the cache existed.
          console.error(`Initial events fetch failed (${res.status})`);
          if (!alive) return;
          setFailed(true);
          setEvents((cur) => cur ?? []);
          return;
        }
        const rows = await res.json();
        void cacheEvents(rows);
        if (alive) apply(rows);
      })
      .catch(async (err: unknown) => {
        // Transport failure (offline): fall back to last-known rows from the
        // cache, funneled through the same `match` mirror and version merge
        // the live stream uses. Callers get `failed` so views can mark the
        // rows as stale instead of letting them read as live.
        // ponytail: no refetch — the next query change retries. Add a retry if
        // a long-lived dashboard losing its history turns out to matter.
        console.error("Initial events fetch failed", err);
        if (!alive) return;
        setFailed(true);
        const cached = await loadCachedEvents();
        if (alive) apply(cached);
      });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [limit, queryKey]);

  return { events, failed, arrived };
};

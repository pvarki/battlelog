import type { InferRequestType } from "hono/client";
import { useEffect, useRef, useState } from "react";
import { api, type EventResponse } from "./api.ts";

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

const open = () => {
  clearTimeout(reopenTimer);
  source?.close();
  const es = new EventSource("/api/v1/events/stream");
  source = es;
  es.addEventListener("open", heardFromServer);
  es.addEventListener("ping", heardFromServer);
  es.addEventListener("event", (e) => {
    heardFromServer();
    const row = JSON.parse(e.data) as EventResponse;
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

/** Latest events, newest first, kept live via the shared SSE stream. */
export const useLiveEvents = ({
  limit = 100,
  query,
  match,
}: LiveEventsOptions = {}): LiveEvents => {
  const [events, setEvents] = useState<EventResponse[] | null>(null);
  const [failed, setFailed] = useState(false);
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
    const apply = (rows: EventResponse[]) => {
      const m = matchRef.current;
      current = mergeEvents(current, relevantRows(current, rows, m), limit);
      if (m) current = current.filter(m);
      setEvents(current);
    };

    setFailed(false);
    // Subscribe before the fetch: merge dedupes rows that arrive on both paths.
    const unsubscribe = subscribeToEvents((row) => {
      if (alive) apply([row]);
    });
    api.events
      .$get({ query: { ...queryRef.current, limit } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
        const rows = await res.json();
        if (alive) apply(rows);
      })
      .catch((err: unknown) => {
        // Keep going live-only: the stream still fills the list. Callers get
        // `failed` so an empty table can say so instead of reading as "none".
        // ponytail: no refetch — the next query change retries. Add a retry if
        // a long-lived dashboard losing its history turns out to matter.
        console.error("Initial events fetch failed", err);
        if (alive) {
          setFailed(true);
          setEvents((cur) => cur ?? []);
        }
      });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [limit, queryKey]);

  return { events, failed };
};

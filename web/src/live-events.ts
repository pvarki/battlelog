import type { InferRequestType } from "hono/client";
import { useEffect, useRef, useState } from "react";
import { api, type EventResponse } from "./api.ts";

type Listener = (row: EventResponse) => void;

// One EventSource per tab: browsers cap HTTP/1.1 at ~6 connections per origin,
// so every consumer multiplexes this single unfiltered stream and filters
// locally. Reconnects (with Last-Event-ID replay) are EventSource built-ins.
const listeners = new Set<Listener>();
let source: EventSource | undefined;

export const subscribeToEvents = (listener: Listener): (() => void) => {
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/api/v1/events/stream");
    source.addEventListener("event", (e) => {
      const row = JSON.parse(e.data) as EventResponse;
      for (const l of listeners) l(row);
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      source?.close();
      source = undefined;
    }
  };
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

/** Latest events, newest first, kept live via the shared SSE stream. `null` until first load. */
export const useLiveEvents = ({
  limit = 100,
  query,
  match,
}: LiveEventsOptions = {}): EventResponse[] | null => {
  const [events, setEvents] = useState<EventResponse[] | null>(null);
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
        // Keep going live-only: the stream still fills the list.
        console.error("Initial events fetch failed", err);
        if (alive) setEvents((cur) => cur ?? []);
      });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [limit, queryKey]);

  return events;
};

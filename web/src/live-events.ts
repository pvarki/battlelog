import { useEffect, useState } from "react";
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

/** Latest events, newest first, kept live via the shared SSE stream. `null` until first load. */
export const useLiveEvents = (limit = 100): EventResponse[] | null => {
  const [events, setEvents] = useState<EventResponse[] | null>(null);

  useEffect(() => {
    let alive = true;
    let current: EventResponse[] = [];
    const apply = (rows: EventResponse[]) => {
      current = mergeEvents(current, rows, limit);
      setEvents(current);
    };

    // Subscribe before the fetch: merge dedupes rows that arrive on both paths.
    const unsubscribe = subscribeToEvents((row) => {
      if (alive) apply([row]);
    });
    api.events
      .$get({ query: { limit } })
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
  }, [limit]);

  return events;
};

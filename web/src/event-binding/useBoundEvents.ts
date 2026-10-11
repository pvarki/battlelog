import { useEffect, useRef, useState } from "react";
import { api, type EventResponse } from "../api.ts";
import { subscribeToEvents } from "../live-events.ts";
import { type BoundState, type BoundValue, resolveBound, setPath } from "./paths.ts";

export const WRITE_DEBOUNCE_MS = 600;
const RETRY_MS = 3000;

/** Reserved field key for the event's own `header` (a NUL can't occur in a data path). */
export const HEADER_FIELD = "\0header";

/** undefined while loading, null when the event does not exist. */
type Head = EventResponse | null;

type Pending = {
  /** The version the edits started from: a newer foreign version makes the save a 409. */
  base: EventResponse;
  fields: Record<string, BoundValue>;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * Live heads of the events bound values read from, plus debounced writes.
 * Edits collect per event and go out as one PATCH of the merged `data` with
 * `baseId`: a concurrent edit by someone else is a 409 that reloads the head
 * (dropping the edits) instead of being overwritten.
 */
export const useBoundEvents = (eventIds: string[], seed: EventResponse[] = []) => {
  const [fetched, setFetched] = useState<Record<string, Head>>({});
  // `seed` rows (a query's live events) win over fetched ones only when newer:
  // a write's response must not be overwritten by an older seed row.
  const heads: Record<string, Head> = { ...fetched };
  for (const row of seed) {
    const current = heads[row.eventId];
    if (!current || row.id > current.id) heads[row.eventId] = row;
  }
  const headsRef = useRef(heads);
  headsRef.current = heads;

  /**
   * Installs a version unless a newer one is known: GETs, the stream and
   * PATCH responses arrive out of order (UUIDv7 ids sort by time). The ref is
   * updated synchronously so a queued save after unmount sees our own write.
   */
  const putHead = (eventId: string, row: Head) => {
    const isNewer = (current: Head | undefined) =>
      row === null ? current === undefined : !current || row.id > current.id;
    if (!isNewer(headsRef.current[eventId])) return;
    headsRef.current = { ...headsRef.current, [eventId]: row };
    setFetched((h) => (isNewer(h[eventId]) ? { ...h, [eventId]: row } : h));
  };

  /** eventId → field → value not yet confirmed by the server; shown over the head. */
  const [drafts, setDrafts] = useState<Record<string, Record<string, BoundValue>>>({});
  const pending = useRef(new Map<string, Pending>());
  const inFlight = useRef(new Set<string>());
  /** Versions this hook wrote: a base superseded only by our own save is rebased, not a conflict. */
  const ownVersions = useRef(new Set<string>());

  const ids = [...new Set(eventIds)].sort().join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: putHead only touches a ref and a state setter
  useEffect(() => {
    const wanted = new Set(ids ? ids.split(",") : []);
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const load = async (eventId: string) => {
      try {
        const res = await api.events[":eventId"].$get({ param: { eventId } });
        if (cancelled) return;
        if (res.status === 404) return putHead(eventId, null);
        if (res.status !== 200) throw new Error(`load failed (${res.status})`);
        const row = await res.json();
        if (!cancelled) putHead(eventId, row);
      } catch {
        // ponytail: blanket retry on transport/5xx errors — back off if it matters.
        if (!cancelled) timers.add(setTimeout(() => load(eventId), 5000));
      }
    };
    for (const eventId of wanted) void load(eventId);

    const unsubscribe = subscribeToEvents((row) => {
      if (wanted.has(row.eventId)) putHead(row.eventId, row);
    });
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      unsubscribe();
    };
  }, [ids]);

  const reload = async (eventId: string) => {
    const res = await api.events[":eventId"].$get({ param: { eventId } });
    if (res.status === 200) putHead(eventId, await res.json());
  };

  const clearDrafts = (eventId: string, fields: string[]) => {
    const stillPending = pending.current.get(eventId)?.fields ?? {};
    setDrafts((d) => {
      const kept = Object.fromEntries(
        Object.entries(d[eventId] ?? {}).filter(([f]) => !fields.includes(f) || f in stillPending),
      );
      return { ...d, [eventId]: kept };
    });
  };

  const flush = async (eventId: string) => {
    const edit = pending.current.get(eventId);
    if (!edit) return;
    clearTimeout(edit.timer);
    if (inFlight.current.has(eventId)) {
      edit.timer = setTimeout(() => flush(eventId), 200);
      return;
    }
    pending.current.delete(eventId);
    const latest = headsRef.current[eventId];
    const base =
      latest && latest.id !== edit.base.id && ownVersions.current.has(latest.id)
        ? latest
        : edit.base;
    const { [HEADER_FIELD]: header, ...fields } = edit.fields;
    let data: unknown = base.data;
    for (const [field, value] of Object.entries(fields)) data = setPath(data, field, value);
    // The server requires a non-empty header: a cleared one keeps the current.
    const headerPatch = typeof header === "string" && header.trim() ? { header } : {};

    inFlight.current.add(eventId);
    let retry = false;
    try {
      const res = await api.events[":eventId"].$patch({
        param: { eventId },
        json: { data, baseId: base.id, ...headerPatch },
      });
      if (res.status === 200) {
        const row = await res.json();
        ownVersions.current.add(row.id);
        putHead(eventId, row);
      } else if (res.status === 409) {
        // Someone else saved first: show theirs; these edits are dropped.
        await reload(eventId).catch(() => {});
      } else {
        retry = true;
      }
    } catch {
      retry = true;
    } finally {
      inFlight.current.delete(eventId);
    }
    if (retry) {
      // Transport or server error: keep the edits (still shown) and try again,
      // merged with anything typed since. ponytail: retries forever, like
      // useEventDocument — a permanent 4xx keeps retrying.
      const newer = pending.current.get(eventId);
      clearTimeout(newer?.timer);
      const again: Pending = { base: edit.base, fields: { ...edit.fields, ...newer?.fields } };
      again.timer = setTimeout(() => flush(eventId), RETRY_MS);
      pending.current.set(eventId, again);
      return;
    }
    clearDrafts(eventId, Object.keys(edit.fields));
  };

  /** Shows the value now; saves after `WRITE_DEBOUNCE_MS` of quiet on that event. */
  const write = (eventId: string, field: string, value: BoundValue) => {
    const path = field === HEADER_FIELD ? field : field.trim();
    let edit = pending.current.get(eventId);
    if (!edit) {
      const head = headsRef.current[eventId];
      if (!head) return;
      edit = { base: head, fields: {} };
      pending.current.set(eventId, edit);
    }
    edit.fields[path] = value;
    clearTimeout(edit.timer);
    edit.timer = setTimeout(() => flush(eventId), WRITE_DEBOUNCE_MS);
    setDrafts((d) => ({ ...d, [eventId]: { ...d[eventId], [path]: value } }));
  };

  // Leaving the page within the debounce window must not drop the last edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush only reads refs and state setters
  useEffect(
    () => () => {
      for (const eventId of pending.current.keys()) void flush(eventId);
    },
    [],
  );

  /** The value to show: an unsaved edit over the head's. */
  const resolve = (eventId: string, field: string): BoundState => {
    if (field === HEADER_FIELD) {
      const head = heads[eventId];
      if (!head) return { state: head === null ? "missing-event" : "loading" };
      return { state: "ok", value: drafts[eventId]?.[HEADER_FIELD] ?? head.header };
    }
    const state = resolveBound(heads[eventId], eventId, field);
    const draft = drafts[eventId]?.[field.trim()];
    return state.state === "ok" && draft !== undefined ? { state: "ok", value: draft } : state;
  };

  return { heads, resolve, write, flush };
};

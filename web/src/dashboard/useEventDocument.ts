import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { cacheEvents, loadCachedEventHead } from "../events-cache.ts";
import { subscribeToEvents } from "../live-events.ts";

export type DocStatus =
  | "idle"
  | "loading"
  | "waiting"
  | "saving"
  | "saved"
  | "error"
  | "stale"
  | "unavailable";

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  idle: "",
  loading: "Loading…",
  waiting: "Unsaved changes…",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying",
  stale: "Updated elsewhere — reloaded",
  unavailable: "Load failed — retrying",
};

type Options<T> = {
  /** Logical event id the document follows (from widget config). */
  eventId: string | undefined;
  /** Event `type` used when the first save creates the event. */
  eventType: string;
  /** Event header (shown in the log) derived from the current value. */
  headerFor: (value: T) => string;
  empty: T;
  /** Extract the document from an event's jsonb `data`. */
  parse: (data: unknown) => T;
  /** First save created the event — persist the id into widget config. */
  onEventIdCaptured: (id: string) => void;
  debounceMs?: number;
};

/**
 * A widget document stored as a versioned event chain: loads the head of the
 * followed eventId, saves edits as new versions (debounced, serialized, with
 * retry and keepalive flush), applies remote versions live from the SSE
 * stream, and creates the event on first save.
 */
export const useEventDocument = <T>(opts: Options<T>) => {
  const [value, setValue] = useState<T>(opts.empty);
  const [status, setStatus] = useState<DocStatus>(opts.eventId ? "loading" : "idle");
  const eventId = useRef(opts.eventId);
  // Id captured by our own first save — its config echo must not reload.
  // (A plain ref-equality guard breaks under StrictMode's double-run.)
  const selfCaptured = useRef<string | undefined>(undefined);
  const pending = useRef<T | null>(null);
  // Guards update(): editing before the followed head has loaded would save
  // an empty doc over the real remote content.
  const loaded = useRef(!opts.eventId);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Follow opts.eventId: initial load, and config changes re-point the
  // document at another chain (dropping any unsent edits to the old one).
  const followedId = opts.eventId;
  useEffect(() => {
    if (followedId && followedId === selfCaptured.current) return;
    selfCaptured.current = undefined;
    if (followedId !== eventId.current) {
      clearTimeout(timer.current);
      pending.current = null;
      eventId.current = followedId;
    }
    loaded.current = !followedId;
    if (!followedId) {
      setValue(optsRef.current.empty);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      setStatus("loading");
      try {
        const res = await api.events[":eventId"].$get({ param: { eventId: followedId } });
        if (cancelled) return;
        // No such chain: the config came from another system (imported
        // dashboard) or the event was deleted. Start empty and editable — the
        // next edit creates a fresh chain and rewrites the id into the config.
        if (res.status === 404) {
          eventId.current = undefined;
          loaded.current = true;
          setValue(optsRef.current.empty);
          setStatus("idle");
          return;
        }
        if (res.status !== 200) throw new Error(`load failed (${res.status})`);
        const row = await res.json();
        void cacheEvents([row]);
        setValue(optsRef.current.parse(row.data));
        loaded.current = true;
        setStatus("idle");
      } catch {
        // Doc stays read-only (update() no-ops) until a load succeeds.
        // ponytail: blanket retry on transport/5xx errors — back off if it matters.
        if (cancelled) return;
        // Status and retry first: a throwing `parse` below must not leave the
        // widget stuck at "Loading…" with the retry loop dead.
        setStatus("unavailable");
        retry = setTimeout(load, 5000);
        // Offline fallback: show the newest cached version while retrying.
        // `loaded` stays false on purpose — an edit of a stale copy could
        // overwrite a newer remote version the moment the link returns.
        const cached = await loadCachedEventHead(followedId);
        if (!cancelled && cached) setValue(optsRef.current.parse(cached.data));
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [followedId]);

  // Live remote versions (another screen saved). Skipped while local edits
  // are unsaved — if ours turn out stale, the 409 path reloads the head.
  useEffect(
    () =>
      subscribeToEvents((row) => {
        if (!eventId.current || row.eventId !== eventId.current) return;
        if (pending.current !== null || saving.current) return;
        setValue(optsRef.current.parse(row.data));
      }),
    [],
  );

  // Unmount with an unsent edit: flush keepalive. (A first-ever save can't
  // persist its captured eventId after unmount; that narrow case is lost.)
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current !== null && eventId.current && !saving.current) {
        fetch(`/api/v1/events/${eventId.current}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            header: optsRef.current.headerFor(pending.current),
            data: pending.current,
          }),
        }).catch(() => {});
      }
    },
    [],
  );

  // One save in flight at a time; edits made mid-save coalesce into the next.
  const runSave = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (pending.current !== null) {
        const doc = pending.current;
        pending.current = null;
        setStatus("saving");
        try {
          if (!eventId.current) {
            const res = await api.events.$post({
              json: {
                header: optsRef.current.headerFor(doc),
                type: optsRef.current.eventType,
                data: doc,
              },
            });
            // Non-201 falls through to the catch: keep the edit, retry.
            if (res.status !== 201) throw new Error(`create failed (${res.status})`);
            const created = await res.json();
            eventId.current = created.eventId;
            selfCaptured.current = created.eventId;
            optsRef.current.onEventIdCaptured(created.eventId);
            setStatus("saved");
          } else {
            const res = await api.events[":eventId"].$patch({
              param: { eventId: eventId.current },
              json: { header: optsRef.current.headerFor(doc), data: doc },
            });
            if (res.status === 200) {
              setStatus("saved");
            } else if (res.status === 409) {
              // Lost a concurrent-edit race: take the remote head.
              const head = await api.events[":eventId"].$get({
                param: { eventId: eventId.current },
              });
              if (head.status === 200) setValue(optsRef.current.parse((await head.json()).data));
              setStatus("stale");
            } else {
              // Non-2xx falls through to the catch: keep the edit, retry.
              throw new Error(`save failed (${res.status})`);
            }
          }
        } catch {
          // Network blip or server error: keep the newest unsaved value and
          // retry shortly. ponytail: retries forever, even on a permanent 4xx.
          pending.current ??= doc;
          setStatus("error");
          timer.current = setTimeout(runSave, 3000);
          return;
        }
      }
    } finally {
      saving.current = false;
    }
  };

  const update = (next: T) => {
    if (!loaded.current) return;
    setValue(next);
    pending.current = next;
    setStatus("waiting");
    clearTimeout(timer.current);
    timer.current = setTimeout(runSave, optsRef.current.debounceMs ?? 2000);
  };

  const flush = () => {
    clearTimeout(timer.current);
    void runSave();
  };

  return { value, update, flush, status };
};

import type { EventResponse } from "./api.ts";

// Offline read cache: rows mirrored from the SSE stream and initial fetches,
// so the log stays readable when the link drops. Read-only fallback — writes
// stay online-only, and staleness stays visible to callers (`failed`), which
// is why this is explicit in the client and not a service worker transparently
// faking fresh responses.

const DB_NAME = "battlelog-events-cache";
const STORE = "events";
const CURSOR_KEY = "battlelog.eventsCursor";

export const MAX_ROWS = 10_000;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Cache retention is not a sane replay window: resuming a 30-day-old cursor
// would page through weeks of rows at REPLAY_LIMIT per reconnect. Past this,
// start live-only and let the initial fetches reseed history.
export const CURSOR_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

// UUIDv7 opens with 48 bits of unix millis, so a timestamp converts to the
// smallest id of that instant and plain string order doubles as age order.
export const idCutoff = (now: number, maxAgeMs = MAX_AGE_MS): string => {
  const hex = Math.max(0, now - maxAgeMs)
    .toString(16)
    .padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8)}-0000-0000-000000000000`;
};

// Keys arrive ascending (IndexedDB key order): drop rows past the age cutoff,
// plus the oldest overflow beyond the row cap.
export const staleKeys = (keys: string[], cutoff: string, maxRows: number): string[] => {
  const overflow = keys.length - maxRows;
  return keys.filter((key, i) => i < overflow || key < cutoff);
};

export const isCursorFresh = (id: string | null | undefined, now: number): id is string =>
  !!id && id >= idCutoff(now, CURSOR_MAX_AGE_MS);

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

let dbPromise: Promise<IDBDatabase | undefined> | undefined;

const openDb = (): Promise<IDBDatabase | undefined> => {
  dbPromise ??= new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined); // no IndexedDB (private mode etc.): cache is simply off
    }
  });
  return dbPromise;
};

const store = (db: IDBDatabase, mode: IDBTransactionMode) =>
  db.transaction(STORE, mode).objectStore(STORE);

let lastSweep = 0;

/**
 * Mirror rows into the cache in one transaction. Resolves true only once the
 * transaction commits — the caller's cursor must not advance past rows that
 * were never stored (browsers evict IndexedDB independently of localStorage).
 */
export const cacheEvents = async (rows: EventResponse[]): Promise<boolean> => {
  if (rows.length === 0) return true;
  try {
    const db = await openDb();
    if (!db) return false;
    const tx = db.transaction(STORE, "readwrite");
    const s = tx.objectStore(STORE);
    for (const row of rows) s.put(row);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    // Wall-display tabs live for days: sweep periodically, not just at open,
    // or the caps stop being caps and quota failures eat the newest writes.
    const now = Date.now();
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = now;
      evictStale(now).catch(() => {}); // oversized until the next sweep
    }
    return true;
  } catch {
    return false; // a failed write only costs offline depth
  }
};

// Version rows share an eventId; the highest row id is the chain's head.
export const newestVersion = (
  rows: EventResponse[],
  eventId: string,
): EventResponse | undefined => {
  let head: EventResponse | undefined;
  for (const row of rows) {
    if (row.eventId === eventId && (!head || row.id > head.id)) head = row;
  }
  return head;
};

/** Newest cached version of one event chain, if any. */
export const loadCachedEventHead = async (eventId: string): Promise<EventResponse | undefined> =>
  // ponytail: linear scan, runs only on failed loads — index eventId if it matters
  newestVersion(await loadCachedEvents(), eventId);

/** Every cached row. Empty when the cache is missing or broken. */
export const loadCachedEvents = async (): Promise<EventResponse[]> => {
  try {
    const db = await openDb();
    return db ? await request(store(db, "readonly").getAll()) : [];
  } catch {
    return [];
  }
};

const evictStale = async (now: number): Promise<void> => {
  const db = await openDb();
  if (!db) return;
  const s = store(db, "readwrite");
  const keys = (await request(s.getAllKeys())) as string[];
  for (const key of staleKeys(keys, idCutoff(now), MAX_ROWS)) s.delete(key);
};

/** Resume point for the SSE stream. Absent or expired means start live-only. */
export const loadCursor = (): string | undefined => {
  try {
    const id = globalThis.localStorage?.getItem(CURSOR_KEY);
    return isCursorFresh(id, Date.now()) ? id : undefined;
  } catch {
    return undefined;
  }
};

export const saveCursor = (id: string): void => {
  try {
    globalThis.localStorage?.setItem(CURSOR_KEY, id);
  } catch {
    // storage denied: the next load just replays more
  }
};

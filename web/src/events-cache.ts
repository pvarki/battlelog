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
      open.onsuccess = () => {
        resolve(open.result);
        evictStale(Date.now()).catch(() => {}); // oversized until the next sweep
      };
      open.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined); // no IndexedDB (private mode etc.): cache is simply off
    }
  });
  return dbPromise;
};

const store = (db: IDBDatabase, mode: IDBTransactionMode) =>
  db.transaction(STORE, mode).objectStore(STORE);

/** Mirror rows into the cache. Fire-and-forget: a failed write only costs offline depth. */
export const cacheEvents = (rows: EventResponse[]): void => {
  if (rows.length === 0) return;
  openDb()
    .then((db) => {
      if (!db) return;
      const s = store(db, "readwrite");
      for (const row of rows) s.put(row);
    })
    .catch(() => {});
};

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
    // A cursor past the age window would replay thousands of rows that
    // eviction is about to delete anyway — start fresh instead.
    return id && id >= idCutoff(Date.now()) ? id : undefined;
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

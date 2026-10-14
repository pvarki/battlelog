import type { StoredUid } from "./store.ts";

/**
 * The TAK picture saved in this browser between visits, so the map opens with
 * it at once and only the time since `syncedThrough` is fetched from TAK.
 *
 * Kept per TAK server and callsign, so another user or server never sees it.
 * It's a cache: anything missing or unreadable just means a full reload from
 * TAK. Saving is on unless the viewer turns it off, which also deletes it.
 */

const DB_NAME = "battlelog-tak-picture";
const RECORDS = "records";
const SCOPES = "scopes";
export const SAVING_KEY = "battlelog.tak.savePicture";

type ScopeRecord = { scope: string; syncedThrough?: number };
type PictureRecord = StoredUid & { scope: string };

export type SavedPicture = { records: StoredUid[]; syncedThrough?: number };

export const pictureScope = (takUrl: string, callsign: string) => `${takUrl}|${callsign}`;

export const savingEnabled = (): boolean => {
  try {
    return localStorage.getItem(SAVING_KEY) !== "false";
  } catch {
    return false;
  }
};

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Saving the TAK picture was aborted"));
  });

let dbPromise: Promise<IDBDatabase | undefined> | undefined;

const openDb = (): Promise<IDBDatabase | undefined> => {
  dbPromise ??= new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(RECORDS, { keyPath: ["scope", "uid"] });
        open.result.createObjectStore(SCOPES, { keyPath: "scope" });
      };
      open.onsuccess = () => {
        // Another tab upgrading the schema: let it, and reopen on the next use.
        open.result.onversionchange = () => {
          open.result.close();
          dbPromise = undefined;
        };
        resolve(open.result);
      };
      open.onerror = () => resolve(undefined);
      open.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined); // no IndexedDB (some private windows): the picture lasts until the page closes
    }
  });
  return dbPromise;
};

// Array keys sort after strings, so [scope, []] bounds every [scope, uid].
const scopeRange = (scope: string) => IDBKeyRange.bound([scope], [scope, []]);

export const loadPicture = async (scope: string): Promise<SavedPicture | undefined> => {
  const db = await openDb();
  if (!db) return undefined;
  const tx = db.transaction([RECORDS, SCOPES]);
  const [records, meta] = await Promise.all([
    request(tx.objectStore(RECORDS).getAll(scopeRange(scope)) as IDBRequest<PictureRecord[]>),
    request(tx.objectStore(SCOPES).get(scope) as IDBRequest<ScopeRecord | undefined>),
  ]);
  return {
    records: records.map(({ scope: _, ...record }) => record),
    syncedThrough: meta?.syncedThrough,
  };
};

/**
 * Saves the given uids' current records (undefined: nothing kept, so deleted)
 * and, when given, how far TAK's history has been fetched: in one
 * transaction, so a crash never records a sync whose items weren't saved.
 */
export const savePicture = async (
  scope: string,
  changes: { uid: string; record: StoredUid | undefined }[],
  syncedThrough?: number,
): Promise<void> => {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction([RECORDS, SCOPES], "readwrite");
  const records = tx.objectStore(RECORDS);
  for (const { uid, record } of changes) {
    if (record) records.put({ ...record, scope });
    else records.delete([scope, uid]);
  }
  if (syncedThrough !== undefined) tx.objectStore(SCOPES).put({ scope, syncedThrough });
  await done(tx);
};

/** Deletes one saved picture, e.g. one too old to catch up from. */
export const forgetPicture = async (scope: string): Promise<void> => {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction([RECORDS, SCOPES], "readwrite");
  tx.objectStore(RECORDS).delete(scopeRange(scope));
  tx.objectStore(SCOPES).delete(scope);
  await done(tx);
};

/** Deletes every saved picture in this browser; turning saving off calls it. */
export const forgetSavedPictures = async (): Promise<void> => {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction([RECORDS, SCOPES], "readwrite");
  tx.objectStore(RECORDS).clear();
  tx.objectStore(SCOPES).clear();
  await done(tx);
};

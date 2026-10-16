import type { ChatMessage } from "./chat/chat.ts";
import type { TakItem } from "./cot.ts";
import { loadCallsign } from "./identity.ts";
import { takBaseUrl } from "./rest.ts";
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
const MISSIONS = "missions";
const CHAT = "chat";
const STORES = [RECORDS, SCOPES, MISSIONS, CHAT];
// The same eight days as the picture's delete marks.
const CHAT_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
export const SAVING_KEY = "battlelog.tak.savePicture";

type ScopeRecord = { scope: string; syncedThrough?: number };
type PictureRecord = StoredUid & { scope: string };
type MissionRecord = {
  scope: string;
  name: string;
  version: string;
  items: TakItem[];
  savedAt: number;
};
// Older than the history a visit replays, a saved item's edits could be missed: refetch instead.
const MISSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
type ChatRecord = { scope: string; id: string; message: ChatMessage };

export type SavedPicture = { records: StoredUid[]; syncedThrough?: number };

/** Which saved picture is this user's on this TAK server; undefined without a callsign. */
export const currentScope = async (): Promise<string | undefined> => {
  const callsign = await loadCallsign().catch(() => null);
  return callsign ? `${takBaseUrl()}|${callsign}` : undefined;
};

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
      const open = indexedDB.open(DB_NAME, 3);
      open.onupgradeneeded = () => {
        const db = open.result;
        const create = (name: string, keyPath: string | string[]) => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        };
        create(RECORDS, ["scope", "uid"]);
        create(SCOPES, "scope");
        create(MISSIONS, ["scope", "name"]);
        create(CHAT, ["scope", "id"]);
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
  const tx = db.transaction(STORES, "readwrite");
  tx.objectStore(RECORDS).delete(scopeRange(scope));
  tx.objectStore(SCOPES).delete(scope);
  tx.objectStore(MISSIONS).delete(scopeRange(scope));
  tx.objectStore(CHAT).delete(scopeRange(scope));
  await done(tx);
};

/** Deletes every saved picture in this browser; turning saving off calls it. */
export const forgetSavedPictures = async (): Promise<void> => {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(STORES, "readwrite");
  for (const store of STORES) tx.objectStore(store).clear();
  await done(tx);
};

/** A mission's items as last loaded, with the version they match; undefined when none is saved. */
export const loadSavedMission = async (
  name: string,
): Promise<{ version: string; items: TakItem[] } | undefined> => {
  const scope = savingEnabled() ? await currentScope() : undefined;
  const db = scope ? await openDb() : undefined;
  if (!db || !scope) return undefined;
  const tx = db.transaction(MISSIONS);
  const saved = await request(
    tx.objectStore(MISSIONS).get([scope, name]) as IDBRequest<MissionRecord | undefined>,
  );
  return saved && saved.savedAt > Date.now() - MISSION_MAX_AGE_MS ? saved : undefined;
};

export const saveMission = async (name: string, version: string, items: TakItem[]) => {
  const scope = savingEnabled() ? await currentScope() : undefined;
  const db = scope ? await openDb() : undefined;
  if (!db || !scope) return;
  const tx = db.transaction(MISSIONS, "readwrite");
  tx.objectStore(MISSIONS).put({ scope, name, version, items, savedAt: Date.now() });
  await done(tx);
};

// Anyone on TAK can send chat: keep a bounded history, and restore only what the chat store holds.
const MAX_SAVED_CHAT = 5000;
const RESTORED_CHAT = 1000;
const PRUNE_CHAT_EVERY = 100;
let chatWrites = 0;

/** The saved chat worth keeping, oldest first: within eight days, and the newest MAX_SAVED_CHAT. */
export const chatToKeep = (records: ChatRecord[], now: number): ChatRecord[] =>
  records
    .filter((r) => r.message.time > now - CHAT_RETENTION_MS)
    .sort((a, b) => a.message.time - b.message.time)
    .slice(-MAX_SAVED_CHAT);

/** Deletes the scope's saved chat not worth keeping, and returns the rest. */
const pruneChat = async (store: IDBObjectStore, scope: string, now: number) => {
  const records = await request(store.getAll(scopeRange(scope)) as IDBRequest<ChatRecord[]>);
  const kept = chatToKeep(records, now);
  const keptIds = new Set(kept.map((r) => r.id));
  for (const r of records) if (!keptIds.has(r.id)) store.delete([scope, r.id]);
  return kept;
};

/**
 * Chat kept in this browser: TAK Server doesn't archive chat, so this is the
 * only copy a reload can come back to. What isn't worth keeping is deleted as
 * it's read, and every so often as messages are saved.
 */
export const loadSavedChat = async (now = Date.now()): Promise<ChatMessage[]> => {
  const scope = savingEnabled() ? await currentScope() : undefined;
  const db = scope ? await openDb() : undefined;
  if (!db || !scope) return [];
  const tx = db.transaction(CHAT, "readwrite");
  const kept = await pruneChat(tx.objectStore(CHAT), scope, now);
  await done(tx);
  return kept.slice(-RESTORED_CHAT).map((r) => r.message);
};

export const saveChatMessage = async (message: ChatMessage) => {
  const scope = savingEnabled() ? await currentScope() : undefined;
  const db = scope ? await openDb() : undefined;
  if (!db || !scope) return;
  const tx = db.transaction(CHAT, "readwrite");
  const store = tx.objectStore(CHAT);
  store.put({ scope, id: message.id, message });
  if (++chatWrites % PRUNE_CHAT_EVERY === 0) await pruneChat(store, scope, Date.now());
  await done(tx);
};

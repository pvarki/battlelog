import { strFromU8, unzipSync } from "fflate";
import { useSyncExternalStore } from "react";

/**
 * ATAK icon sets: zips of `iconset.xml` plus one folder of images per group.
 * Markers name an icon as `<iconset uid>/<group>/<file>`; ATAK finds it by
 * set uid and file name alone, so file names are unique within a set. Sets
 * are imported by the user and kept in this browser (IndexedDB).
 */

export type IconsetIcon = {
  group: string;
  file: string;
  /** CoT type ATAK gives a marker placed with this icon (`type2525b`). */
  type?: string;
  mime: "image/png" | "image/jpeg";
  image: Uint8Array;
};

export type Iconset = {
  uid: string;
  name: string;
  /** Draw icons at their own size instead of ATAK's 32 px square. */
  skipResize: boolean;
  /** Import time; tells a re-imported set's images apart from cached ones. */
  imported: number;
  icons: IconsetIcon[];
};

export type IconsetsState = { sets: Iconset[]; loaded: boolean };

const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_ICON_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_ICONS = 5000; // ATAK's own cap
const DEFAULT_GROUP = "Other";

const imageMime = (bytes: Uint8Array): IconsetIcon["mime"] | undefined => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return undefined;
};

const isImageName = (name: string) => /\.(png|jpe?g)$/i.test(name);

const isSafeSegment = (segment: string) =>
  segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\\");

/** Group and file name from a zip entry path, as ATAK reads them; undefined for unsafe paths. */
const groupAndFile = (path: string): { group: string; file: string } | undefined => {
  const segments = path.split("/");
  if (!segments.every(isSafeSegment)) return undefined;
  const file = segments[segments.length - 1] as string;
  return { group: segments.length > 1 ? (segments[0] as string) : DEFAULT_GROUP, file };
};

/** An icon set from the bytes of its zip. Throws a user-readable error when it isn't one. */
export const parseIconset = (zip: Uint8Array, imported = Date.now()): Iconset => {
  if (zip.length > MAX_ZIP_BYTES) throw new Error("Icon set is larger than 20 MB");
  let total = 0;
  let wanted = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: ({ name, size, originalSize }) => {
        if (name !== "iconset.xml" && !isImageName(name)) return false;
        // Stored entries are copied by their compressed size, which a forged zip can inflate.
        const bytes = Math.max(size, originalSize);
        if (bytes > MAX_ICON_BYTES || wanted > MAX_ICONS) return false;
        total += bytes;
        wanted++;
        return total <= MAX_TOTAL_BYTES;
      },
    });
  } catch {
    throw new Error("Not a zip file");
  }

  const xml = entries["iconset.xml"];
  if (!xml) throw new Error("No iconset.xml: not an ATAK icon set");
  const root = new DOMParser().parseFromString(strFromU8(xml), "application/xml").documentElement;
  const uid = root?.nodeName === "iconset" ? root.getAttribute("uid")?.trim() : undefined;
  if (!uid || uid.includes("/")) throw new Error("iconset.xml has no valid uid");
  const types = new Map(
    Array.from(root.getElementsByTagName("icon")).map((icon) => [
      icon.getAttribute("name"),
      icon.getAttribute("type2525b") || undefined,
    ]),
  );

  const seen = new Set<string>();
  const icons = Object.entries(entries).flatMap(([path, image]): IconsetIcon[] => {
    const place = path === "iconset.xml" ? undefined : groupAndFile(path);
    const mime = imageMime(image);
    if (!place || !mime || seen.has(place.file.toLowerCase())) return [];
    seen.add(place.file.toLowerCase());
    return [{ ...place, type: types.get(place.file), mime, image }];
  });
  if (icons.length === 0) throw new Error("Icon set has no PNG or JPEG icons");

  return {
    uid,
    name: root.getAttribute("name")?.trim() || uid,
    skipResize: root.getAttribute("skipResize") === "true",
    imported,
    icons,
  };
};

export const iconsetPath = (set: Iconset, icon: IconsetIcon) =>
  `${set.uid}/${icon.group}/${icon.file}`;

const DB_NAME = "battlelog-tak-iconsets";
const STORE = "iconsets";

let state: IconsetsState = { sets: [], loaded: false };
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const set = (sets: Iconset[]) => {
  state = { sets: sets.sort((a, b) => a.name.localeCompare(b.name)), loaded: true };
  const current = new Set(sets.map((s) => `${s.uid}|${s.imported}|`));
  for (const [key, bitmap] of bitmaps) {
    if (current.has(key.slice(0, key.lastIndexOf("|") + 1))) continue;
    bitmaps.delete(key);
    if (bitmap instanceof ImageBitmap) bitmap.close();
  }
  notify();
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
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "uid" });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined); // no IndexedDB (private mode): sets last until the page closes
    }
  });
  return dbPromise;
};

let loading: Promise<void> | undefined;

const load = () => {
  loading ??= openDb().then(async (db) => {
    const stored = db
      ? await request(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<Iconset[]>)
      : [];
    set(stored);
  });
  return loading;
};

export const useIconsets = (): IconsetsState => {
  void load();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
};

/** Imports or, like ATAK, replaces the set with the same uid. */
export const importIconset = async (file: File): Promise<Iconset> => {
  const iconset = parseIconset(new Uint8Array(await file.arrayBuffer()));
  await load();
  set([...state.sets.filter((s) => s.uid !== iconset.uid), iconset]);
  const db = await openDb();
  if (db) await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(iconset));
  return iconset;
};

export const removeIconset = async (uid: string) => {
  set(state.sets.filter((s) => s.uid !== uid));
  const db = await openDb();
  if (db) await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(uid));
};

/** An icon's decoded image, keyed so a re-imported set never reuses the old one. */
export type IconsetImage = { key: string; bitmap: ImageBitmap; natural: boolean };

const bitmaps = new Map<string, ImageBitmap | "decoding" | "failed">();

/**
 * The image for an ATAK `iconsetpath`, or undefined until its set is loaded
 * and the image decoded (listeners of onIconsetImage hear when it is), or
 * when no imported set has it.
 */
export const iconsetImage = (path: string): IconsetImage | undefined => {
  void load();
  const segments = path.split("/");
  const iconset = state.sets.find((s) => s.uid === segments[0]);
  const file = segments.length > 1 ? segments[segments.length - 1] : undefined;
  const icon = iconset?.icons.find((i) => i.file === file);
  if (!iconset || !icon) return undefined;
  const key = `${iconset.uid}|${iconset.imported}|${icon.file}`;
  const bitmap = bitmaps.get(key);
  if (bitmap instanceof ImageBitmap) return { key, bitmap, natural: iconset.skipResize };
  if (!bitmap) {
    bitmaps.set(key, "decoding");
    createImageBitmap(new Blob([icon.image.slice()], { type: icon.mime })).then(
      (decoded) => {
        // Its set was removed or re-imported while decoding.
        if (bitmaps.get(key) !== "decoding") return decoded.close();
        bitmaps.set(key, decoded);
        notify();
      },
      () => bitmaps.set(key, "failed"),
    );
  }
  return undefined;
};

/** Calls back when imported sets or decoded icons change, so the map can redraw. */
export const onIconsetsChanged = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

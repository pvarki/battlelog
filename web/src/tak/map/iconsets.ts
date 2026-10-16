import { strFromU8, unzipSync } from "fflate";
import { useSyncExternalStore } from "react";
import { readCapped, TakRequestError, takBaseUrl } from "../rest.ts";
import { remember, touch } from "./lru.ts";

/**
 * ATAK icon sets: zips of `iconset.xml` plus one folder of images per group.
 * Markers name an icon as `<iconset uid>/<group>/<file>`; ATAK finds it by
 * set uid and file name alone, so file names are unique within a set. Sets
 * are imported by the user and kept in this browser (IndexedDB); icons of
 * other sets are fetched from TAK Server, which may have them.
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

/** Bumped whenever a set or a decoded icon changes, so drawings cached with the old look are redone. */
let version = 0;
export const iconsetsVersion = () => version;
// A lookup per drawn item: a linear search of every set and icon was a redraw hot spot.
let index: Map<string, { set: Iconset; icons: Map<string, IconsetIcon> }> | undefined;

const notify = () => {
  version++;
  for (const listener of listeners) listener();
};

const set = (sets: Iconset[]) => {
  state = { sets: sets.sort((a, b) => a.name.localeCompare(b.name)), loaded: true };
  index = undefined;
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

// Markers name the icons, so both caches below are capped, least recently used going first.
const MAX_CACHED_ICONS = 2000;

const bitmaps = new Map<string, ImageBitmap | "decoding" | "failed">();

const keepBitmap = (key: string, value: ImageBitmap | "decoding" | "failed") => {
  for (const old of remember(bitmaps, key, value, MAX_CACHED_ICONS))
    if (old instanceof ImageBitmap) old.close();
};

const fetchServerIcon = async ([uid, group, file]: string[]): Promise<ImageBitmap> => {
  const path = `/Marti/api/icon/${[uid, group, file].map((s) => encodeURIComponent(s ?? "")).join("/")}`;
  const res = await fetch(`${takBaseUrl()}${path}`, { credentials: "include" });
  if (!res.ok) throw new TakRequestError(path, res.status);
  const image = await readCapped(res, MAX_ICON_BYTES, () => new Error("Icon is too large"));
  const mime = imageMime(image);
  if (!mime) throw new Error("Icon is not a PNG or JPEG");
  return createImageBitmap(new Blob([image], { type: mime }));
};

// By path, misses included: a set TAK doesn't have is asked for once per page, not per redraw.
const serverIcons = new Map<string, IconsetImage | "fetching" | "missing">();

const keepServerIcon = (path: string, value: IconsetImage | "fetching" | "missing") => {
  for (const old of remember(serverIcons, path, value, MAX_CACHED_ICONS))
    if (typeof old !== "string") old.bitmap.close();
};

/** An icon from a set only TAK Server has, fetched on first use. */
const serverIcon = (segments: string[]): IconsetImage | undefined => {
  const path = segments.join("/");
  const cached = touch(serverIcons, path);
  if (cached) return typeof cached === "string" ? undefined : cached;
  // COT_MAPPING_* paths name ATAK's built-in symbols, which no server set holds.
  if (segments.length !== 3 || path.startsWith("COT_MAPPING_")) {
    keepServerIcon(path, "missing");
    return undefined;
  }
  keepServerIcon(path, "fetching");
  fetchServerIcon(segments).then(
    (bitmap) => {
      keepServerIcon(path, { key: `tak|${path}`, bitmap, natural: false });
      notify();
    },
    () => keepServerIcon(path, "missing"),
  );
  return undefined;
};

/**
 * The image for an ATAK `iconsetpath`, or undefined until its set is loaded
 * and the image decoded (listeners of onIconsetImage hear when it is), or
 * when neither an imported set nor TAK Server has it.
 */
export const iconsetImage = (path: string): IconsetImage | undefined => {
  void load();
  if (!state.loaded) return undefined;
  const segments = path.split("/");
  index ??= new Map(
    state.sets.map((s) => [s.uid, { set: s, icons: new Map(s.icons.map((i) => [i.file, i])) }]),
  );
  const indexed = index.get(segments[0] ?? "");
  if (!indexed) return serverIcon(segments);
  const file = segments.length > 1 ? segments[segments.length - 1] : undefined;
  const iconset = indexed.set;
  const icon = file === undefined ? undefined : indexed.icons.get(file);
  if (!icon) return undefined;
  const key = `${iconset.uid}|${iconset.imported}|${icon.file}`;
  const bitmap = touch(bitmaps, key);
  if (bitmap instanceof ImageBitmap) return { key, bitmap, natural: iconset.skipResize };
  if (!bitmap) {
    keepBitmap(key, "decoding");
    createImageBitmap(new Blob([icon.image.slice()], { type: icon.mime })).then(
      (decoded) => {
        // Its set was removed or re-imported (or it was evicted) while decoding.
        if (bitmaps.get(key) !== "decoding") return decoded.close();
        keepBitmap(key, decoded);
        notify();
      },
      () => keepBitmap(key, "failed"),
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

import { notifications } from "@mantine/notifications";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { useSyncExternalStore } from "react";
import { publish } from "../commands.ts";
import { type CotEvent, type TakChange, toChange } from "../cot.ts";
import type { Sender } from "../identity.ts";
import type { Mission } from "../missions/missions.ts";
import { addItems, ensureSubscribed, removeItems } from "../missions/writes.ts";
import { parseCotXml, serializeCot } from "../protocol/cot-xml.ts";
import { geojsonToEvents, gpxToEvents, kmlToEvents } from "./overlay-files.ts";

/**
 * Plans: drafts prepared before anything reaches TAK. A plan holds new items
 * and changed copies of existing ones, lives only in this browser
 * (IndexedDB), and is published in one go, or moved between machines and
 * ATAK as a data package.
 */

export type PlanEntry = {
  event: CotEvent;
  /** For a changed existing item: its TAK version when the change was made. */
  basedOn?: number;
};

export type Plan = { id: string; name: string; updated: number; entries: PlanEntry[] };

export type PlansState = { plans: Plan[]; activeId: string | undefined; loaded: boolean };

const DB_NAME = "battlelog-tak-plans";
const STORE = "plans";
const ACTIVE_KEY = "battlelog.tak.activePlan";

const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

let state: PlansState = { plans: [], activeId: readActive(), loaded: false };
const listeners = new Set<() => void>();

const set = (patch: Partial<PlansState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
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
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined); // no IndexedDB (private mode): plans live until the page closes
    }
  });
  return dbPromise;
};

const write = async (plan: Plan | { id: string; deleted: true }) => {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  if ("deleted" in plan) store.delete(plan.id);
  else store.put(plan);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
};

const persist = (plan: Plan | { id: string; deleted: true }) =>
  write(plan).catch((err: unknown) =>
    notifications.show({
      color: "danger",
      title: "Plan not saved in this browser",
      message: `It will be lost on reload; export it to keep it. (${String(err)})`,
    }),
  );

let loading: Promise<void> | undefined;

const load = () => {
  loading ??= (async () => {
    const db = await openDb();
    const stored = db
      ? await request(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<Plan[]>)
      : [];
    // Plans made before the read finished are newer than anything stored.
    const made = new Set(state.plans.map((p) => p.id));
    const plans = [...state.plans, ...stored.filter((p) => !made.has(p.id))];
    set({ plans: plans.sort((a, b) => b.updated - a.updated), loaded: true });
  })().catch((err: unknown) => {
    console.warn("TAK plans could not be read", err);
    set({ loaded: true });
  });
  return loading;
};

const save = (plan: Plan) => {
  const next = { ...plan, updated: Date.now() };
  set({ plans: [next, ...state.plans.filter((p) => p.id !== plan.id)] });
  void persist(next);
  return next;
};

export const usePlans = (): PlansState => {
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

/** New items and changes go into this plan instead of straight to TAK; undefined = Live mode. */
export const setActivePlan = (id: string | undefined) => {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // storage denied: the choice lasts until reload
  }
  set({ activeId: id });
};

export const createPlan = (name: string): Plan =>
  save({ id: crypto.randomUUID(), name, updated: 0, entries: [] });

export const renamePlan = (plan: Plan, name: string) => save({ ...plan, name });

export const deletePlan = (plan: Plan) => {
  set({ plans: state.plans.filter((p) => p.id !== plan.id) });
  if (state.activeId === plan.id) setActivePlan(undefined);
  void persist({ id: plan.id, deleted: true });
};

// Several changes in one go each start from the plan the previous one saved.
const latest = (plan: Plan) => state.plans.find((p) => p.id === plan.id) ?? plan;

/** Adds or replaces (same uid) a draft; a changed existing item keeps its first known base. */
export const addToPlan = (stale: Plan, entry: PlanEntry) => {
  const plan = latest(stale);
  const previous = plan.entries.find((e) => e.event.uid === entry.event.uid);
  const kept = { ...entry, basedOn: previous?.basedOn ?? entry.basedOn };
  save({
    ...plan,
    entries: [...plan.entries.filter((e) => e.event.uid !== entry.event.uid), kept],
  });
};

/** The plan's draft for `uid` as stored now, not as the last render saw it. */
export const draftOf = (stale: Plan, uid: string): PlanEntry | undefined =>
  latest(stale).entries.find((e) => e.event.uid === uid);

export const removeFromPlan = (stale: Plan, uid: string) => {
  const plan = latest(stale);
  save({ ...plan, entries: plan.entries.filter((e) => e.event.uid !== uid) });
};

/** The plan with every draft re-issued now, keeping each one's lifetime, so receivers take it as current. */
export const reissuePlan = (plan: Plan, now = Date.now()): Plan => ({
  ...plan,
  entries: plan.entries.map((entry) => ({
    ...entry,
    event: {
      ...entry.event,
      time: now,
      start: now,
      stale: now + (entry.event.stale - entry.event.time),
    },
  })),
});

/** Sends every draft to TAK, re-issued now; resolves to the drafts TAK confirmed. */
const sendDrafts = async (plan: Plan): Promise<PlanEntry[]> => {
  const results = await Promise.all(reissuePlan(plan).entries.map((entry) => publish(entry.event)));
  return plan.entries.filter((_, i) => results[i]);
};

const dropFromPlan = (plan: Plan, done: ReadonlySet<PlanEntry>) => {
  // Drafts added or changed while publishing aren't the ones that were done: keep them.
  const current = state.plans.find((p) => p.id === plan.id);
  if (current) save({ ...current, entries: current.entries.filter((e) => !done.has(e)) });
};

/**
 * Sends every draft to TAK, re-issued now. Drafts TAK confirms leave the plan;
 * the rest stay so nothing is lost. Returns how many went out.
 */
export const publishPlan = async (plan: Plan): Promise<{ sent: number; kept: number }> => {
  const published = await sendDrafts(plan);
  dropFromPlan(plan, new Set(published));
  return { sent: published.length, kept: plan.entries.length - published.length };
};

const targetUid = (change: TakChange) => (change.kind === "upsert" ? change.item.uid : change.uid);

/** What the drafts change in a mission: items drawn or edited join it, deleted ones leave it. */
export const missionChanges = (entries: PlanEntry[], itemUids: readonly string[]) => {
  const changes = entries.flatMap(({ event }) => toChange(event) ?? []);
  return {
    add: changes.flatMap((c) => (c.kind === "upsert" ? [c.item.uid] : [])),
    remove: changes.flatMap((c) =>
      c.kind === "delete" && itemUids.includes(c.uid) ? [c.uid] : [],
    ),
  };
};

/**
 * Publishes the drafts as live CoT, then adds their items to the mission in
 * one change and takes staged deletes out of it. A draft leaves the plan only
 * once it is both on TAK and in (or out of) the mission; `notInMission`
 * names the uids that aren't.
 */
export const publishPlanToMission = async (
  plan: Plan,
  mission: Pick<Mission, "name" | "itemUids">,
  clientUid: string,
): Promise<{ sent: number; kept: number; notInMission: string[] }> => {
  // Before sending anything: TAK silently ignores mission changes from non-subscribers.
  await ensureSubscribed(mission.name, clientUid);
  const published = await sendDrafts(plan);
  const { add, remove } = missionChanges(published, mission.itemUids);
  const missed = new Set([
    ...(add.length ? await addItems(mission.name, add, clientUid) : []),
    ...(remove.length ? await removeItems(mission.name, remove, clientUid) : []),
  ]);
  const done = published.filter((entry) => {
    const change = toChange(entry.event);
    return !change || !missed.has(targetUid(change));
  });
  dropFromPlan(plan, new Set(done));
  return {
    sent: published.length,
    kept: plan.entries.length - done.length,
    notInMission: [...missed],
  };
};

const escapeXml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * A zip path segment from a uid. Uids come from TAK or imported files, and a
 * receiver extracting `../` or `/` would write outside the package.
 */
export const safeZipName = (s: string) =>
  s.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}|^\./g, "_") || "_";

/** The plan as an ATAK data package: one CoT file per item, importable in ATAK or another browser. */
export const exportPlan = (plan: Plan): Blob => {
  const files: Record<string, Uint8Array> = {};
  const contents = plan.entries
    .map(({ event }, i) => {
      const dir = `${i}-${safeZipName(event.uid)}`;
      const entry = `${dir}/${dir}.cot`;
      files[entry] = strToU8(serializeCot(event));
      return `<Content ignore="false" zipEntry="${escapeXml(entry)}"><Parameter name="uid" value="${escapeXml(event.uid)}"/></Content>`;
    })
    .join("");
  files["MANIFEST/manifest.xml"] = strToU8(
    `<MissionPackageManifest version="2"><Configuration><Parameter name="uid" value="${escapeXml(plan.id)}"/><Parameter name="name" value="${escapeXml(plan.name)}"/></Configuration><Contents>${contents}</Contents></MissionPackageManifest>`,
  );
  return new Blob([zipSync(files).slice()], { type: "application/zip" });
};

export const MAX_PACKAGE_BYTES = 50 * 1_048_576;
const MAX_COT_BYTES = 1_048_576;

/**
 * The accepted entries of a zip from elsewhere, refusing one that expands
 * past the limits. Entries not accepted are never decompressed.
 */
export const unzipLimited = (
  zip: Uint8Array,
  accept: (path: string) => boolean,
  maxEntryBytes = MAX_COT_BYTES,
): Record<string, Uint8Array> => {
  let total = 0;
  return unzipSync(zip, {
    filter: (entry) => {
      if (!accept(entry.name)) return false;
      // Stored entries are copied by their compressed size, which a forged zip can inflate.
      const bytes = Math.max(entry.size, entry.originalSize);
      total += bytes;
      if (bytes > maxEntryBytes || total > MAX_PACKAGE_BYTES)
        throw new Error("Package expands too large to import");
      return true;
    },
  });
};

export const isCot = (path: string) => path.toLowerCase().endsWith(".cot");

/**
 * Only map items become drafts: a file from elsewhere must not be able to
 * make the user publish deletes or other control messages under their own name.
 */
export const planFromEvents = (name: string, events: CotEvent[]): Plan => {
  const entries = events
    .filter((event) => toChange(event)?.kind === "upsert")
    .map((event) => ({ event }));
  return save({ ...createPlan(name), entries });
};

/** The CoT in a data package (ours or ATAK's). */
const packageEvents = (files: Record<string, Uint8Array>): CotEvent[] =>
  Object.entries(files)
    .filter(([path]) => isCot(path))
    .flatMap(([, bytes]) => parseCotXml(strFromU8(bytes)));

const kmzToKml = (zip: Uint8Array) => {
  const files = unzipLimited(zip, (path) => path.toLowerCase().endsWith(".kml"), MAX_PACKAGE_BYTES);
  // Google Earth reads doc.kml, or else the first KML in the archive.
  const kml = files["doc.kml"] ?? Object.values(files)[0];
  if (!kml) throw new Error("No KML in the KMZ");
  return strFromU8(kml);
};

const isShp = (path: string) => /\.shp$/i.test(path);

/** macOS zips carry AppleDouble copies (`__MACOSX/`, `._x.shp`) that aren't the real files. */
const isShapefilePart = (path: string) =>
  /\.(shp|dbf|prj|cpg)$/i.test(path) && !/(^|\/)(__MACOSX\/|\._)/.test(path);

/** Every layer among the files: each .shp with its same-named .dbf, .prj and .cpg. */
const shapefileEvents = async (
  files: Record<string, Uint8Array>,
  sender: Sender,
): Promise<CotEvent[]> => {
  // Its .prj reprojection needs proj4, which is too big to load with the map.
  const { readShapefile } = await import("./shapefile.ts");
  const byPath = new Map(Object.entries(files).map(([path, bytes]) => [path.toLowerCase(), bytes]));
  const features = Object.keys(files)
    .filter(isShp)
    .flatMap((shpPath) => {
      const sibling = (ext: string) => byPath.get(`${shpPath.slice(0, -3)}${ext}`.toLowerCase());
      const text = (ext: string) => {
        const bytes = sibling(ext);
        return bytes && strFromU8(bytes);
      };
      const shp = files[shpPath] as Uint8Array;
      return readShapefile({ shp, dbf: sibling("dbf"), prj: text("prj"), cpg: text("cpg") })
        .features;
    });
  return geojsonToEvents({ type: "FeatureCollection", features }, sender);
};

export const IMPORT_ACCEPT = ".zip,.kml,.kmz,.gpx,.geojson,.json,.shp,.shx,.dbf,.prj,.cpg";

const stem = (file: File) => file.name.replace(/\.[^.]*$/, "");

/**
 * A plan from a data package, KML/KMZ, GPX, GeoJSON or shapefile (zipped, or
 * its .shp picked together with the .dbf and .prj); drawings name `sender` as
 * their creator.
 */
export const importPlan = async (files: File[], sender: Sender): Promise<Plan> => {
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_PACKAGE_BYTES)
    throw new Error("File is too large to import");
  const shp = files.find((f) => isShp(f.name));
  if (shp) {
    const loose = Object.fromEntries(
      await Promise.all(files.map(async (f) => [f.name, new Uint8Array(await f.arrayBuffer())])),
    );
    return planFromEvents(stem(shp), await shapefileEvents(loose, sender));
  }
  const [file] = files;
  if (!file || files.length > 1)
    throw new Error("Import one file at a time, or a shapefile's .shp with its .dbf and .prj");
  const extension = file.name.match(/\.([^.]*)$/)?.[1]?.toLowerCase();
  const name = stem(file);
  if (extension === "kml") return planFromEvents(name, kmlToEvents(await file.text(), sender));
  if (extension === "gpx") return planFromEvents(name, gpxToEvents(await file.text(), sender));
  if (extension === "geojson" || extension === "json")
    return planFromEvents(name, geojsonToEvents(await file.text(), sender));
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension === "kmz") return planFromEvents(name, kmlToEvents(kmzToKml(bytes), sender));
  const shapefile = unzipLimited(bytes, isShapefilePart, MAX_PACKAGE_BYTES);
  if (Object.keys(shapefile).some(isShp))
    return planFromEvents(name, await shapefileEvents(shapefile, sender));
  return planFromEvents(name, packageEvents(unzipLimited(bytes, isCot)));
};

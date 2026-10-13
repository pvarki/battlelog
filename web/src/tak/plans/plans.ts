import { notifications } from "@mantine/notifications";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { useSyncExternalStore } from "react";
import { publish } from "../commands.ts";
import { type CotEvent, toChange } from "../cot.ts";
import { parseCotXml, serializeCot } from "../protocol/cot-xml.ts";

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
      color: "red",
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

/** Adds or replaces (same uid) a draft; a changed existing item keeps its first known base. */
export const addToPlan = (plan: Plan, entry: PlanEntry) => {
  const previous = plan.entries.find((e) => e.event.uid === entry.event.uid);
  const kept = { ...entry, basedOn: previous?.basedOn ?? entry.basedOn };
  save({
    ...plan,
    entries: [...plan.entries.filter((e) => e.event.uid !== entry.event.uid), kept],
  });
};

export const removeFromPlan = (plan: Plan, uid: string) =>
  save({ ...plan, entries: plan.entries.filter((e) => e.event.uid !== uid) });

/**
 * Sends every draft to TAK, re-issued now. Drafts TAK confirms leave the plan;
 * the rest stay so nothing is lost. Returns how many went out.
 */
export const publishPlan = async (plan: Plan): Promise<{ sent: number; kept: number }> => {
  const now = Date.now();
  const results = await Promise.all(
    plan.entries.map((entry) =>
      publish({
        ...entry.event,
        time: now,
        start: now,
        stale: now + (entry.event.stale - entry.event.time),
      }),
    ),
  );
  const published = new Set(plan.entries.filter((_, i) => results[i]));
  // Drafts added or changed while publishing aren't the ones TAK confirmed: keep them.
  const current = state.plans.find((p) => p.id === plan.id);
  if (current) save({ ...current, entries: current.entries.filter((e) => !published.has(e)) });
  return { sent: published.size, kept: plan.entries.length - published.size };
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

/**
 * A plan from a data package (ours or ATAK's). Only map items become drafts:
 * a package from elsewhere must not be able to make the user publish deletes
 * or other control messages under their own name.
 */
const MAX_PACKAGE_BYTES = 50 * 1_048_576;
const MAX_COT_BYTES = 1_048_576;

export const importPlan = async (file: File): Promise<Plan> => {
  if (file.size > MAX_PACKAGE_BYTES) throw new Error("Package is too large to import");
  let total = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    // Only CoT files are read; anything else is never decompressed.
    filter: (entry) => {
      if (!entry.name.toLowerCase().endsWith(".cot")) return false;
      // Stored entries are copied by their compressed size, which a forged zip can inflate.
      const bytes = Math.max(entry.size, entry.originalSize);
      total += bytes;
      if (bytes > MAX_COT_BYTES || total > MAX_PACKAGE_BYTES)
        throw new Error("Package expands too large to import");
      return true;
    },
  });
  const events = Object.entries(files)
    .filter(([path]) => path.toLowerCase().endsWith(".cot"))
    .flatMap(([, bytes]) => parseCotXml(strFromU8(bytes)))
    .filter((event) => toChange(event)?.kind === "upsert");
  const plan = createPlan(file.name.replace(/\.zip$/i, ""));
  return save({ ...plan, entries: events.map((event) => ({ event })) });
};

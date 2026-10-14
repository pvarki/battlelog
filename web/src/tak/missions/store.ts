import { useEffect, useId, useSyncExternalStore } from "react";
import type { TakItem } from "../cot.ts";
import { loadSavedMission, saveMission } from "../picture-cache.ts";
import type { CotEvent } from "../protocol/cot-event.ts";
import { MISSION_CHANGE_TYPE, parseMissionChanges } from "./changes.ts";
import {
  fetchInvitedMissions,
  fetchMission,
  fetchMissionItem,
  fetchMissionItems,
  fetchMissions,
  isAccessDenied,
  type Mission,
} from "./missions.ts";

/**
 * Missions from TAK while something holds them, and the items of the missions
 * somebody wants. A mission's items load once (or from the copy saved in this
 * browser) and then follow its changes: from TAK's change notices for
 * subscribed missions, and from the list's item uids, polled as a safety net.
 * Only added items are fetched, one by one; a full download happens only for
 * a mission seen for the first time or changed beyond `MAX_ITEM_FETCHES`.
 */

export type MissionContents =
  | { kind: "loading" }
  | { kind: "loaded"; version: string; items: TakItem[] }
  | { kind: "no-access" }
  | { kind: "failed" };

export type MissionsState = {
  /** null until the first list arrives. */
  missions: Mission[] | null;
  listFailed: boolean;
  contents: ReadonlyMap<string, MissionContents>;
  /** Missions this client is invited to, by name. */
  invitations: string[];
};

// A safety net: subscribed missions stream their changes, and the list is 300 KB on a busy server.
const POLL_MS = 5 * 60_000;
const MAX_ITEM_FETCHES = 50;

let state: MissionsState = {
  missions: null,
  listFailed: false,
  contents: new Map(),
  invitations: [],
};
const listeners = new Set<() => void>();
// Per holder (the Map page, each map widget): what it wants loaded.
const wantedBy = new Map<string, ReadonlySet<string>>();
const isWanted = (name: string) => [...wantedBy.values()].some((names) => names.has(name));
let holders = 0;
let clientUid: string | undefined;
// True from a poll's start until the loop stops, so a quick unmount/remount can't start a second loop.
let polling = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const set = (patch: Partial<MissionsState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const setContents = (name: string, contents: MissionContents) => {
  const next = new Map(state.contents);
  next.set(name, contents);
  set({ contents: next });
  if (contents.kind === "loaded") {
    void saveMission(name, contents.version, contents.items).catch((err) =>
      console.warn(`Saving TAK mission ${name} failed`, err),
    );
  }
};

// Never a real version: contents that missed an item stay due for another reconcile.
const INCOMPLETE = "";

/** The items for `uids`; not `complete` when a fetch failed (a uid without a map item isn't a failure). */
const fetchItems = async (uids: string[]) => {
  let complete = true;
  const fetched = await Promise.all(
    uids.map((uid) =>
      fetchMissionItem(uid).catch(() => {
        complete = false;
        return undefined;
      }),
    ),
  );
  return { items: fetched.filter((item): item is TakItem => !!item), complete };
};

/**
 * `items` brought in line with the mission's uids: removed ones dropped, added
 * ones fetched. Undefined when too many were added to fetch one by one.
 */
const reconciled = async (items: TakItem[], mission: Mission) => {
  const uids = new Set(mission.itemUids);
  const have = new Set(items.map((i) => i.uid));
  const added = mission.itemUids.filter((uid) => !have.has(uid));
  if (added.length > MAX_ITEM_FETCHES) return undefined;
  const fetched = await fetchItems(added);
  return { ...fetched, items: [...items.filter((i) => uids.has(i.uid)), ...fetched.items] };
};

// The latest request per mission; an older response arriving later is dropped.
const latestRequest = new Map<string, number>();
let requests = 0;

const refreshContents = async (mission: Mission) => {
  const current = state.contents.get(mission.name);
  if (current?.kind === "loaded" && current.version === mission.version) return;
  if (current?.kind === "loading") return;
  const request = ++requests;
  latestRequest.set(mission.name, request);
  if (current?.kind !== "loaded") setContents(mission.name, { kind: "loading" });
  try {
    const known =
      current?.kind === "loaded"
        ? current.items
        : (await loadSavedMission(mission.name).catch(() => undefined))?.items;
    const result = (known && (await reconciled(known, mission))) ?? {
      items: await fetchMissionItems(mission.name),
      complete: true,
    };
    if (latestRequest.get(mission.name) !== request) return;
    const version = result.complete ? mission.version : INCOMPLETE;
    setContents(mission.name, { kind: "loaded", version, items: result.items });
  } catch (err) {
    if (latestRequest.get(mission.name) !== request) return;
    if (isAccessDenied(err)) setContents(mission.name, { kind: "no-access" });
    // A failed refresh keeps the items already on the map; the next poll tries again.
    else if (current?.kind !== "loaded") setContents(mission.name, { kind: "failed" });
    else console.warn(`TAK mission ${mission.name} refresh failed`, err);
  }
};

const refreshWanted = () => {
  for (const mission of state.missions ?? []) {
    if (isWanted(mission.name)) void refreshContents(mission);
  }
};

/**
 * TAK's list and the invite-only missions it leaves out: those this client is
 * invited to, wanted, or named in `also`, each fetched by name.
 */
const fetchAll = async (also: string[]) => {
  const [listed, invitations] = await Promise.all([
    fetchMissions(),
    clientUid ? fetchInvitedMissions(clientUid).catch(() => state.invitations) : state.invitations,
  ]);
  const listedNames = new Set(listed.map((m) => m.name));
  const wanted = [...wantedBy.values()].flatMap((names) => [...names]);
  const hidden = [...new Set([...invitations, ...wanted, ...also])].filter(
    (name) => !listedNames.has(name),
  );
  const fetched = await Promise.all(
    hidden.map((name) => fetchMission(name).catch(() => undefined)),
  );
  const missions = [...listed, ...fetched.filter((m): m is Mission => !!m)];
  return { missions, invitations };
};

const applyList = ({ missions, invitations }: Awaited<ReturnType<typeof fetchAll>>) => {
  // A deleted or renamed mission takes its items off the map with it.
  const names = new Set(missions.map((m) => m.name));
  const contents = new Map([...state.contents].filter(([name]) => names.has(name)));
  set({ missions, listFailed: false, contents, invitations });
  refreshWanted();
};

/** Refetches the list now, e.g. to read back a write to one of `also`, and returns it. */
export const refreshMissions = async (also: string[] = []): Promise<Mission[]> => {
  const all = await fetchAll(also);
  applyList(all);
  return all.missions;
};

const poll = async () => {
  timer = undefined;
  try {
    applyList(await fetchAll([]));
  } catch (err) {
    console.warn("TAK mission list failed", err);
    set({ listFailed: true });
  }
  if (holders > 0) timer = setTimeout(() => void poll(), POLL_MS);
  else polling = false;
};

/**
 * Keeps the mission list fresh while mounted and loads the contents of the
 * named missions (those shown on the map or open in the drawer). With
 * `uid`, the list includes the invite-only missions that client is invited to.
 */
export const useMissionsSync = (names: string[], uid?: string) => {
  useEffect(() => {
    if (uid) clientUid = uid;
  }, [uid]);
  useEffect(() => {
    holders++;
    if (!polling) {
      polling = true;
      void poll();
    }
    return () => {
      if (--holders > 0) return;
      // Nothing holds missions: stop the loop now, not after one more large fetch.
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        polling = false;
      }
    };
  }, []);
  const holder = useId();
  const key = names.join("\n");
  useEffect(() => {
    wantedBy.set(holder, new Set(key ? key.split("\n") : []));
    refreshWanted();
    return () => {
      wantedBy.delete(holder);
    };
  }, [holder, key]);
};

export const useMissions = (): MissionsState =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );

/**
 * Applies a live change to the mission's items as they are now, so changes
 * arriving together all land. A reconcile still in flight started before this
 * change and would undo it, so its result is dropped; the next poll redoes it.
 */
const updateItems = (name: string, update: (items: TakItem[]) => TakItem[], complete = true) => {
  const current = state.contents.get(name);
  if (current?.kind !== "loaded") return;
  latestRequest.set(name, ++requests);
  const version = complete ? current.version : INCOMPLETE;
  setContents(name, { ...current, version, items: update(current.items) });
};

/**
 * TAK's change notice for a subscribed mission; true when `event` was one.
 * Item adds and removals apply at once; anything else (files, the mission
 * itself) refreshes the list, which reconciles the rest.
 */
export const receiveMissionChange = (event: CotEvent): boolean => {
  if (event.type !== MISSION_CHANGE_TYPE) return false;
  let refreshList = false;
  for (const { mission, type, uid } of parseMissionChanges(event)) {
    if (type === "ADD_CONTENT" && uid) {
      void fetchItems([uid]).then(({ items: added, complete }) =>
        updateItems(
          mission,
          (items) => [...items.filter((i) => i.uid !== uid), ...added],
          complete,
        ),
      );
    } else if (type === "REMOVE_CONTENT" && uid) {
      updateItems(mission, (items) => items.filter((i) => i.uid !== uid));
    } else {
      refreshList = true;
    }
  }
  if (refreshList) void refreshMissions().catch(() => undefined);
  return true;
};

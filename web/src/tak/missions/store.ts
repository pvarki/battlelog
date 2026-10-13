import { useEffect, useId, useSyncExternalStore } from "react";
import type { TakItem } from "../cot.ts";
import { fetchMissionItems, fetchMissions, isAccessDenied, type Mission } from "./missions.ts";

/**
 * Missions polled from TAK while something holds them. Reading a mission's
 * contents doesn't subscribe to it (that is a write in TAK), so changes arrive
 * by polling the list; a mission's items are refetched only when its newest
 * change moves, and only for the missions somebody wants.
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
};

const POLL_MS = 60_000;

let state: MissionsState = { missions: null, listFailed: false, contents: new Map() };
const listeners = new Set<() => void>();
// Per holder (the Map page, each map widget): what it wants loaded.
const wantedBy = new Map<string, ReadonlySet<string>>();
const isWanted = (name: string) => [...wantedBy.values()].some((names) => names.has(name));
let holders = 0;
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
    const items = await fetchMissionItems(mission.name);
    if (latestRequest.get(mission.name) !== request) return;
    setContents(mission.name, { kind: "loaded", version: mission.version, items });
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

const applyList = (missions: Mission[]) => {
  // A deleted or renamed mission takes its items off the map with it.
  const names = new Set(missions.map((m) => m.name));
  const contents = new Map([...state.contents].filter(([name]) => names.has(name)));
  set({ missions, listFailed: false, contents });
  refreshWanted();
};

/** Refetches the list now, e.g. to read back a write, and returns it. */
export const refreshMissions = async (): Promise<Mission[]> => {
  const missions = await fetchMissions();
  applyList(missions);
  return missions;
};

const poll = async () => {
  timer = undefined;
  try {
    applyList(await fetchMissions());
  } catch (err) {
    console.warn("TAK mission list failed", err);
    set({ listFailed: true });
  }
  if (holders > 0) timer = setTimeout(() => void poll(), POLL_MS);
  else polling = false;
};

/**
 * Keeps the mission list fresh while mounted and loads the contents of the
 * named missions (those shown on the map or open in the drawer).
 */
export const useMissionsSync = (names: string[]) => {
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

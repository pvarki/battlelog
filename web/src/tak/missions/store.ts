import { useEffect, useSyncExternalStore } from "react";
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
  | { kind: "loaded"; changedAt: number; items: TakItem[] }
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
let wanted = new Set<string>();
let holders = 0;
// True from a poll's start until the loop stops, so a quick unmount/remount can't start a second loop.
let polling = false;

const set = (patch: Partial<MissionsState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const setContents = (name: string, contents: MissionContents) => {
  const next = new Map(state.contents);
  next.set(name, contents);
  set({ contents: next });
};

const refreshContents = async (mission: Mission) => {
  const current = state.contents.get(mission.name);
  if (current?.kind === "loading") return;
  if (current?.kind === "loaded" && current.changedAt === mission.changedAt) return;
  if (current?.kind !== "loaded") setContents(mission.name, { kind: "loading" });
  try {
    const items = await fetchMissionItems(mission.name);
    setContents(mission.name, { kind: "loaded", changedAt: mission.changedAt, items });
  } catch (err) {
    setContents(mission.name, { kind: isAccessDenied(err) ? "no-access" : "failed" });
  }
};

const refreshWanted = () => {
  for (const mission of state.missions ?? []) {
    if (wanted.has(mission.name)) void refreshContents(mission);
  }
};

const poll = async () => {
  try {
    set({ missions: await fetchMissions(), listFailed: false });
    refreshWanted();
  } catch (err) {
    console.warn("TAK mission list failed", err);
    set({ listFailed: true });
  }
  if (holders > 0) setTimeout(() => void poll(), POLL_MS);
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
      holders--;
    };
  }, []);
  const key = names.join("\n");
  useEffect(() => {
    wanted = new Set(key ? key.split("\n") : []);
    refreshWanted();
  }, [key]);
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

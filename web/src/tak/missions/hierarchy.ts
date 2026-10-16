import { useEffect, useSyncExternalStore } from "react";
import { takGetText } from "../rest.ts";
import { type Mission, missionPath } from "./missions.ts";

/**
 * TAK Server can nest missions (feeds) under a parent. ATAK doesn't show it,
 * and TAK's mission list doesn't carry it, so each mission's parent is asked
 * for on its own, only while something shows the hierarchy.
 */

/** The parent's name from `GET …/parent`; undefined when it has none (TAK answers 404). */
export const parseParent = (json: unknown): string | undefined => {
  const data = (json as { data?: unknown })?.data;
  const mission = (Array.isArray(data) ? data[0] : data) as { name?: unknown } | undefined;
  return typeof mission?.name === "string" && mission.name ? mission.name : undefined;
};

export const fetchParent = async (name: string): Promise<string | undefined> => {
  const text = await takGetText(`${missionPath(name)}/parent`);
  return text ? parseParent(JSON.parse(text)) : undefined;
};

/** Parent per mission name; null when it has none, missing until known. */
let parents: ReadonlyMap<string, string | null> = new Map();
const listeners = new Set<() => void>();
// Per name: only the newest request may answer, so an older one can't undo a newer write.
const generation = new Map<string, number>();
const RETRY_MS = 10_000;
const MAX_TRIES = 3;

export const knownParents = () => parents;

/** Records what TAK confirmed, e.g. after this client set it. */
export const knowParent = (name: string, parent: string | null) => {
  generation.set(name, (generation.get(name) ?? 0) + 1);
  parents = new Map(parents).set(name, parent);
  for (const listener of listeners) listener();
};

/** Asks TAK again; a failed read is retried a few times before it's left unknown. */
export const refreshParent = async (name: string, tries = 1): Promise<void> => {
  const asked = (generation.get(name) ?? 0) + 1;
  generation.set(name, asked);
  try {
    const parent = (await fetchParent(name)) ?? null;
    if (generation.get(name) === asked) knowParent(name, parent);
  } catch (err) {
    console.warn(`Couldn't read the parent of TAK mission ${name}`, err);
    if (tries < MAX_TRIES && generation.get(name) === asked)
      setTimeout(() => void refreshParent(name, tries + 1), RETRY_MS);
  }
};

/**
 * The parents of `names` while `enabled`, read again each time it turns on or
 * the names change: another client may have moved a feed since. The last
 * known parents show meanwhile.
 */
export const useMissionParents = (names: string[], enabled: boolean) => {
  const key = names.join("\n");
  useEffect(() => {
    if (!enabled || !key) return;
    for (const name of key.split("\n")) void refreshParent(name);
  }, [key, enabled]);
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, knownParents);
};

export type TreeRow = { mission: Mission; depth: number };

/**
 * Missions in tree order: each parent followed by its children, newest change
 * first at every level. A mission whose parent isn't listed (gone, or hidden
 * from this client) is a root, and so is one caught in a cycle.
 */
export const missionTree = (
  missions: Mission[],
  parentOf: ReadonlyMap<string, string | null>,
): TreeRow[] => {
  const byName = new Map(missions.map((m) => [m.name, m]));
  const newestFirst = (a: Mission, b: Mission) => b.changedAt - a.changedAt;
  const childrenOf = new Map<string, Mission[]>();
  const roots: Mission[] = [];
  for (const mission of missions) {
    const parent = parentOf.get(mission.name);
    if (parent && byName.has(parent) && parent !== mission.name) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), mission]);
    } else roots.push(mission);
  }
  const rows: TreeRow[] = [];
  const placed = new Set<string>();
  const visit = (mission: Mission, depth: number) => {
    if (placed.has(mission.name)) return;
    placed.add(mission.name);
    rows.push({ mission, depth });
    for (const child of (childrenOf.get(mission.name) ?? []).sort(newestFirst))
      visit(child, depth + 1);
  };
  for (const root of roots.sort(newestFirst)) visit(root, 0);
  // Left over: missions whose parents form a cycle, never reached from a root.
  for (const mission of [...missions].sort(newestFirst)) visit(mission, 0);
  return rows;
};

/** Every mission under `name`, at any depth: none of them may become its parent. */
export const descendantsOf = (
  name: string,
  parentOf: ReadonlyMap<string, string | null>,
): Set<string> => {
  const found = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [child, parent] of parentOf) {
      if (parent && (parent === name || found.has(parent)) && !found.has(child) && child !== name) {
        found.add(child);
        grew = true;
      }
    }
  }
  return found;
};

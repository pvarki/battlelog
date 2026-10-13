import type { TakItem } from "./cot.ts";

/**
 * ATAK's Overlay Manager groups, in display order (after ATAK-CIV
 * `assets/filters/overlays_hier.xml`). Team groups are named by team colour
 * and so aren't listed.
 */
export const GROUP_LABEL: Record<string, string> = {
  alerts: "Alerts",
  markers: "Markers",
  "markers/team": "Team",
  "markers/hostile": "Hostile",
  "markers/friendly": "Friendly",
  "markers/friendly/troops": "Troops",
  "markers/friendly/vehicles": "Ground Vehicles",
  "markers/friendly/air": "Air",
  "markers/friendly/ships": "Ships",
  "markers/friendly/structures": "Structures",
  "markers/friendly/other": "Other",
  "markers/neutral": "Neutral",
  "markers/unknown": "Unknown",
  "markers/spot": "Spot Map",
  navigation: "Navigation",
  "navigation/routes": "Routes",
  "navigation/waypoints": "Waypoints",
  shapes: "Drawing Objects",
  other: "Other",
};

const ORDER = Object.keys(GROUP_LABEL);

const FRIENDLY: [prefix: string, group: string][] = [
  ["a-f-G-U-C", "troops"],
  ["a-f-G-E-V", "vehicles"],
  ["a-f-A", "air"],
  ["a-f-S", "ships"],
  ["a-f-U", "ships"],
  ["a-f-G-I", "structures"],
];

/** `a-f-G` is `a-f-G` itself or anything under it, but not `a-f-GX`. */
const isA = (type: string, prefix: string) => type === prefix || type.startsWith(`${prefix}-`);

/** Where an item sits in the overlay tree; the first matching rule wins, as in ATAK. */
export const groupOf = (item: TakItem): string[] => {
  const t = item.type;
  if (isA(t, "b-a")) return ["alerts"];
  if (item.team) return ["markers", "team", item.team];
  if (["a-h", "a-j", "a-k", "a-s"].some((p) => isA(t, p))) return ["markers", "hostile"];
  if (isA(t, "a-f") || isA(t, "a-a")) {
    const sub = FRIENDLY.find(([prefix]) => isA(t, prefix))?.[1] ?? "other";
    return ["markers", "friendly", sub];
  }
  if (isA(t, "a-n")) return ["markers", "neutral"];
  if (isA(t, "a")) return ["markers", "unknown"];
  if (isA(t, "b-m-p-s")) return ["markers", "spot"];
  if (isA(t, "b-m-r")) return ["navigation", "routes"];
  if (["b-m-p-w", "b-m-p-c", "b-m-p-i"].some((p) => isA(t, p))) return ["navigation", "waypoints"];
  if (isA(t, "u-d")) return ["shapes"];
  return ["other"];
};

/** Hidden when the item's group or any group above it is. */
export const isHidden = (path: string[], hidden: ReadonlySet<string>): boolean =>
  path.some((_, i) => hidden.has(path.slice(0, i + 1).join("/")));

export type Group = {
  key: string;
  label: string;
  count: number;
  items: TakItem[];
  children: Group[];
};

const rank = (key: string) => ORDER.indexOf(key);

const sortTree = (groups: Group[]): Group[] => {
  groups.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
  for (const g of groups) sortTree(g.children);
  return groups;
};

/** The items as the overlay tree, holding only groups that have items. */
export const groupTree = (items: TakItem[]): Group[] => {
  const roots: Group[] = [];
  for (const item of items) {
    let siblings = roots;
    let group: Group | undefined;
    const path = groupOf(item);
    for (const [i, name] of path.entries()) {
      const key = path.slice(0, i + 1).join("/");
      group = siblings.find((g) => g.key === key);
      if (!group) {
        group = { key, label: GROUP_LABEL[key] ?? name, count: 0, items: [], children: [] };
        siblings.push(group);
      }
      group.count++;
      siblings = group.children;
    }
    group?.items.push(item);
  }
  return sortTree(roots);
};

import type { Position, TakItem } from "./cot.ts";

export type ItemStatus = "online" | "stale" | "offline";

export const statusOf = (item: TakItem, now: number): ItemStatus => {
  if (item.offline) return "offline";
  return item.stale < now ? "stale" : "online";
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  online: "Current",
  stale: "Stale",
  offline: "Disconnected",
};

/** ATAK reports 0,0 when a device has no position fix (e.g. WinTAK without location). */
export const hasPosition = (item: TakItem): boolean =>
  item.geometry.type !== "Point" ||
  item.geometry.coordinates[0] !== 0 ||
  item.geometry.coordinates[1] !== 0;

/** A representative point: the item itself, or a shape's first vertex. */
export const anchorOf = (item: TakItem): Position => {
  const g = item.geometry;
  if (g.type === "Point") return g.coordinates;
  if (g.type === "LineString") return g.coordinates[0] ?? [0, 0];
  return g.coordinates[0]?.[0] ?? [0, 0];
};

export const labelOf = (item: TakItem): string => item.callsign ?? item.uid;

/** ATAK's team colours, as its team markers are tinted. */
const TEAM_COLOR: Record<string, string> = {
  White: "#ffffff",
  Yellow: "#ffff00",
  Orange: "#ff7700",
  Magenta: "#ff00ff",
  Red: "#ff0000",
  Maroon: "#7f0000",
  Purple: "#7f007f",
  "Dark Blue": "#00007f",
  Blue: "#0000ff",
  Cyan: "#00ffff",
  Teal: "#007f7f",
  Green: "#00ff00",
  "Dark Green": "#007f00",
  Brown: "#a0714f",
};

export const teamColor = (team: string | undefined): string =>
  (team && TEAM_COLOR[team]) || "#00ffff";

const AFFILIATION_LETTER: Record<string, string> = {
  f: "F",
  a: "A",
  h: "H",
  s: "S",
  j: "J",
  k: "K",
  n: "N",
  u: "U",
  p: "P",
};

/**
 * The 2525 symbol to draw: the sender's own `__milsym` choice, else one
 * derived from the CoT atom type (`a-f-G-U-C-I` → `SFGPUCI--------`, friendly
 * ground infantry). Unknown function codes still get the right frame.
 */
export const sidcOf = (item: TakItem): string | undefined => {
  if (item.sidc) return item.sidc;
  if (!item.type.startsWith("a-")) return undefined;
  const [, affiliation = "u", dimension = "G", ...fn] = item.type.split("-");
  const letter = AFFILIATION_LETTER[affiliation] ?? "U";
  return `S${letter}${dimension}P${fn.join("").padEnd(6, "-").slice(0, 6)}-----`;
};

const AFFILIATION_NAME: Record<string, string> = {
  f: "Friendly",
  a: "Assumed friend",
  h: "Hostile",
  s: "Suspect",
  j: "Joker",
  k: "Faker",
  n: "Neutral",
  u: "Unknown",
  p: "Pending",
};

const DIMENSION_NAME: Record<string, string> = {
  G: "ground",
  A: "air",
  S: "sea",
  U: "subsurface",
  P: "space",
  F: "SOF",
};

// Most specific prefix first.
const OTHER_TYPE_NAME: [prefix: string, name: string][] = [
  ["b-m-p-s-p-i", "Sensor point of interest"],
  ["b-m-p-s-m", "Spot marker"],
  ["b-m-p-w", "Waypoint"],
  ["b-m-p-c", "Checkpoint"],
  ["b-m-r", "Route"],
  ["b-m-p", "Map point"],
  ["u-d-c-c", "Circle"],
  ["u-d-c-e", "Ellipse"],
  ["u-d-r", "Rectangle"],
  ["u-d-f", "Line"],
  ["u-d-p", "Point"],
  ["u-d-", "Drawing"],
];

/** Plain-language name for an item's type, e.g. `a-h-G` → "Hostile ground unit". */
export const describeType = (item: TakItem): string => {
  const t = item.type;
  if (item.team) return "TAK user";
  if (t.startsWith("a-")) {
    const [, affiliation = "", dimension = ""] = t.split("-");
    const where = DIMENSION_NAME[dimension];
    return `${AFFILIATION_NAME[affiliation] ?? "Unknown"} ${where ? `${where} ` : ""}unit`;
  }
  return OTHER_TYPE_NAME.find(([prefix]) => t.startsWith(prefix))?.[1] ?? "Map item";
};

/** `ATAK-CIV 5.8.0.4 (174b425).1787255575-CIV` → `ATAK-CIV 5.8.0.4`. */
export const shortDevice = (device: string): string => device.replace(/\s*\(.*$/, "");

/** "12 s", "4 min", "3 h", "2 d" ago. */
export const formatAge = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
};

/**
 * ATAK's unit statuses, as it writes them into the 2525 code: the 4th
 * character of a 2525C code, the 7th digit of a 2525D one.
 */
export const UNIT_STATUSES = {
  present: { label: "Present", c: "P", d: "0" },
  anticipated: { label: "Anticipated / planned", c: "A", d: "1" },
  capable: { label: "Fully capable", c: "C", d: "2" },
  damaged: { label: "Damaged", c: "D", d: "3" },
  destroyed: { label: "Destroyed", c: "X", d: "4" },
  full: { label: "Full to capacity", c: "F", d: "5" },
} as const;

export type UnitStatus = keyof typeof UNIT_STATUSES;

const isNumericSidc = (sidc: string) => /^\d{20,30}$/.test(sidc);

export const unitStatusOf = (sidc: string): UnitStatus => {
  const at = isNumericSidc(sidc) ? sidc[6] : sidc[3];
  const match = Object.entries(UNIT_STATUSES).find(
    ([, s]) => (isNumericSidc(sidc) ? s.d : s.c) === at,
  );
  return (match?.[0] as UnitStatus | undefined) ?? "present";
};

export const withUnitStatus = (sidc: string, status: UnitStatus): string => {
  const numeric = isNumericSidc(sidc);
  const at = numeric ? 6 : 3;
  const value = numeric ? UNIT_STATUSES[status].d : UNIT_STATUSES[status].c;
  return sidc.slice(0, at) + value + sidc.slice(at + 1);
};

import { forward } from "mgrs";
import type { TakFeature, TakMission } from "../../api.ts";
import type { Layer, TakMapConfig } from "./widget.ts";

/** Which toggleable layer a TAK item belongs to. */
export const layerOf = (f: TakFeature): Layer => {
  const t = f.properties.cotType;
  if (t.startsWith("u-d-") || t === "b-m-r") return "drawings";
  if (t.startsWith("b-")) return "markers";
  // ATAK/WinTAK users announce a team; units placed on the map don't.
  return f.properties.team ? "contacts" : "units";
};

const AFFILIATION: Record<string, string> = {
  f: "F",
  h: "H",
  n: "N",
  u: "U",
  a: "A",
  s: "S",
  j: "J",
  k: "K",
  p: "P",
  o: "U",
  x: "U",
};

/**
 * 2525B letter SIDC for a CoT atom type: `a-f-G-U-C-I` is friendly ground
 * infantry, `SFGPUCI--------`. Unknown function codes still get the right frame.
 */
export const sidcFor = (cotType: string): string => {
  const [, aff = "u", dimension = "G", ...fn] = cotType.split("-");
  return `S${AFFILIATION[aff] ?? "U"}${dimension}P${fn.join("").padEnd(6, "-").slice(0, 6)}-----`;
};

/** ATAK's team colours. */
const TEAM_COLOR: Record<string, string> = {
  White: "#ffffff",
  Yellow: "#ffff00",
  Orange: "#ff8000",
  Magenta: "#ff00ff",
  Red: "#ff0000",
  Maroon: "#800000",
  Purple: "#800080",
  "Dark Blue": "#00008b",
  Blue: "#0000ff",
  Cyan: "#00ffff",
  Teal: "#008080",
  Green: "#00ff00",
  "Dark Green": "#006400",
  Brown: "#a52a2a",
};

export const TEAMS = Object.keys(TEAM_COLOR);

export const teamColor = (team: string | undefined): string =>
  (team && TEAM_COLOR[team]) || "#00ffff";

/** Greyed out like ATAK: past its stale time, or its user disconnected. */
export const isFaded = (f: TakFeature, now: number): boolean =>
  f.properties.offline === true || Date.parse(f.properties.stale) < now;

/** ATAK reports 0,0 when a device has no GPS fix (e.g. WinTAK without location). */
export const hasPosition = (f: TakFeature): boolean =>
  f.geometry.type !== "Point" || f.geometry.coordinates[0] !== 0 || f.geometry.coordinates[1] !== 0;

/** A representative point: the item itself, or a shape's first vertex. */
export const anchorOf = (f: TakFeature): [lon: number, lat: number] => {
  const g = f.geometry;
  if (g.type === "Point") return g.coordinates;
  if (g.type === "LineString") return g.coordinates[0] ?? [0, 0];
  return g.coordinates[0]?.[0] ?? [0, 0];
};

/**
 * MGRS at 1 m, grouped like ATAK shows it: `35V LG 85650 72345`. Undefined
 * beyond 80°S–84°N, where MGRS hands over to UPS.
 */
export const formatMgrs = ([lon, lat]: [number, number]): string | undefined => {
  try {
    const m = forward([lon, lat], 5);
    return `${m.slice(0, -12)} ${m.slice(-12, -10)} ${m.slice(-10, -5)} ${m.slice(-5)}`;
  } catch {
    return undefined;
  }
};

export type Status = "online" | "offline" | "stale";

export const statusOf = (f: TakFeature, now: number): Status => {
  if (f.properties.offline) return "offline";
  return Date.parse(f.properties.stale) < now ? "stale" : "online";
};

const STATUS_ORDER: Record<Status, number> = { online: 0, stale: 1, offline: 2 };

/** TAK users, connected first, then by callsign. */
export const contactsOf = (items: TakFeature[], now: number): TakFeature[] =>
  items
    .filter((f) => layerOf(f) === "contacts")
    .sort(
      (a, b) =>
        STATUS_ORDER[statusOf(a, now)] - STATUS_ORDER[statusOf(b, now)] ||
        (a.properties.callsign ?? a.id).localeCompare(b.properties.callsign ?? b.id),
    );

export const missionShown = (config: TakMapConfig, name: string): boolean =>
  config.missionNames.includes(name) === (config.missionFilter === "only");

/** Live items this widget's filters let through. */
export const liveItems = (items: TakFeature[], config: TakMapConfig, now: number): TakFeature[] => {
  if (!config.showLive) return [];
  const minTime = config.maxAgeMinutes === null ? -Infinity : now - config.maxAgeMinutes * 60_000;
  return items.filter((f) => {
    const { team, time } = f.properties;
    if (team && config.teams.length > 0 && !config.teams.includes(team)) return false;
    if (Date.parse(time) < minTime) return false;
    return config.showStale || !isFaded(f, now);
  });
};

/**
 * Contents of the shown missions, minus items already shown live (a mission
 * marker that is also live would otherwise be drawn twice).
 */
export const missionItems = (
  missions: TakMission[],
  config: TakMapConfig,
  live: TakFeature[],
): TakFeature[] => {
  const seen = new Set(live.map((f) => f.id));
  return missions
    .filter((m) => missionShown(config, m.name))
    .flatMap((m) => m.items)
    .filter((f) => !seen.has(f.id) && seen.add(f.id));
};

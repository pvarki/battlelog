import type { TakFeature } from "../../api.ts";
import type { Layer } from "./widget.ts";

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

export const teamColor = (team: string | undefined): string =>
  (team && TEAM_COLOR[team]) || "#00ffff";

/** Greyed out like ATAK: past its stale time, or its user disconnected. */
export const isFaded = (f: TakFeature, now: number): boolean =>
  f.properties.offline === true || Date.parse(f.properties.stale) < now;

/** ATAK reports 0,0 when a device has no GPS fix (e.g. WinTAK without location). */
export const hasPosition = (f: TakFeature): boolean =>
  f.geometry.type !== "Point" || f.geometry.coordinates[0] !== 0 || f.geometry.coordinates[1] !== 0;

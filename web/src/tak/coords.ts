import { forward, toPoint } from "mgrs";
import proj4 from "proj4";
import type { Position } from "./cot.ts";

export const COORD_FORMATS = {
  mgrs: "MGRS",
  dd: "Decimal degrees",
  ddm: "Degrees, decimal minutes",
  dms: "Degrees, minutes, seconds",
  tm35fin: "ETRS-TM35FIN",
} as const;

export type CoordFormat = keyof typeof COORD_FORMATS;

const TM35FIN = "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

/** `35V LG 85650 72345`, grouped like ATAK. Undefined beyond 80°S–84°N, where MGRS hands over to UPS. */
const formatMgrs = (position: Position): string | undefined => {
  try {
    const m = forward(position, 5);
    return `${m.slice(0, -12)} ${m.slice(-12, -10)} ${m.slice(-10, -5)} ${m.slice(-5)}`;
  } catch {
    return undefined;
  }
};

const hemisphere = (value: number, positive: string, negative: string) =>
  value < 0 ? negative : positive;

const sexagesimal = (value: number, withSeconds: boolean, degreeDigits: number) => {
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  let minutes = (abs - degrees) * 60;
  if (!withSeconds) {
    // Round before splitting so 59.9995' never prints as 60.000'.
    minutes = Math.round(minutes * 1000) / 1000;
    if (minutes >= 60) [degrees, minutes] = [degrees + 1, 0];
    return `${String(degrees).padStart(degreeDigits, "0")}°${minutes.toFixed(3).padStart(6, "0")}'`;
  }
  let seconds = Math.round((minutes - Math.floor(minutes)) * 600) / 10;
  minutes = Math.floor(minutes);
  if (seconds >= 60) [minutes, seconds] = [minutes + 1, 0];
  if (minutes >= 60) [degrees, minutes] = [degrees + 1, 0];
  return `${String(degrees).padStart(degreeDigits, "0")}°${String(minutes).padStart(2, "0")}'${seconds.toFixed(1).padStart(4, "0")}"`;
};

export const formatCoord = ([lon, lat]: Position, format: CoordFormat): string => {
  const ns = hemisphere(lat, "N", "S");
  const ew = hemisphere(lon, "E", "W");
  switch (format) {
    case "mgrs":
      return formatMgrs([lon, lat]) ?? formatCoord([lon, lat], "dd");
    case "dd":
      return `${Math.abs(lat).toFixed(5)}°${ns} ${Math.abs(lon).toFixed(5)}°${ew}`;
    case "ddm":
      return `${sexagesimal(lat, false, 2)}${ns} ${sexagesimal(lon, false, 3)}${ew}`;
    case "dms":
      return `${sexagesimal(lat, true, 2)}${ns} ${sexagesimal(lon, true, 3)}${ew}`;
    case "tm35fin": {
      const [e, n] = proj4("WGS84", TM35FIN, [lon, lat]);
      return `N ${Math.round(n as number)} E ${Math.round(e as number)}`;
    }
  }
};

const inRange = ([lon, lat]: Position): Position | undefined =>
  Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : undefined;

const parseMgrs = (text: string): Position | undefined => {
  const compact = text.replace(/\s+/g, "").toUpperCase();
  if (!/^\d{1,2}[C-X][A-Z]{2}(\d{2}){0,5}$/.test(compact)) return undefined;
  try {
    const [lon, lat] = toPoint(compact);
    return inRange([lon as number, lat as number]);
  } catch {
    return undefined;
  }
};

/** `N 6675000 E 385000`; Finnish P/I letters too. */
const parseTm35fin = (text: string): Position | undefined => {
  const m = /^[NP]\s*:?\s*(\d{7})(?:\.\d+)?[\s,;]+[EI]\s*:?\s*(\d{6})(?:\.\d+)?$/i.exec(text);
  if (!m) return undefined;
  const [lon, lat] = proj4(TM35FIN, "WGS84", [Number(m[2]), Number(m[1])]);
  return inRange([lon as number, lat as number]);
};

// Minutes and seconds need their marks: without them "60,1 24,9" (decimal
// commas) would read as degrees and minutes.
const ANGLE = String.raw`(-?\d+(?:[.,]\d+)?)\s*°?\s*(?:(\d+(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d+(?:[.,]\d+)?)\s*["″]\s*)?`;
const ANGLE_PAIR = new RegExp(String.raw`^${ANGLE}([NS])?[\s,;]+${ANGLE}([EW])?$`, "i");

const angle = (deg?: string, min?: string, sec?: string, hemi?: string): number => {
  const n = (s?: string) => Number((s ?? "0").replace(",", "."));
  const value = Math.abs(n(deg)) + n(min) / 60 + n(sec) / 3600;
  const negative =
    deg?.startsWith("-") || hemi?.toUpperCase() === "S" || hemi?.toUpperCase() === "W";
  return negative ? -value : value;
};

/** `60.17, 24.94`, `60°10.2'N 24°56.4'E`, `60°10'12"N 24°56'24"E` — latitude first. */
const parseLatLon = (text: string): Position | undefined => {
  const m = ANGLE_PAIR.exec(text.trim());
  if (!m) return undefined;
  const lat = angle(m[1], m[2], m[3], m[4]);
  const lon = angle(m[5], m[6], m[7], m[8]);
  return inRange([lon, lat]);
};

/** Any supported format, whatever the display setting; undefined if it isn't a coordinate. */
export const parseCoord = (text: string): Position | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return parseMgrs(trimmed) ?? parseTm35fin(trimmed) ?? parseLatLon(trimmed);
};

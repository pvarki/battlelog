import { type CotEvent, childNamed } from "./protocol/cot-event.ts";

export type { CotEvent };

export type Position = [lon: number, lat: number];

export type TakGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };

export type TakColor = { color: string; opacity: number };

export type StrokeStyle = "solid" | "dashed" | "dotted" | "outlined";

/** One thing on the TAK map: a user, a unit, a marker or a drawing. */
export type TakItem = {
  uid: string;
  type: string;
  time: number;
  stale: number;
  geometry: TakGeometry;
  /** Height above the ellipsoid in metres; TAK's "unknown" (9999999) is dropped. */
  hae?: number;
  callsign?: string;
  /** TAK users announce a team (colour) and role; placed items don't. */
  team?: string;
  role?: string;
  remarks?: string;
  battery?: number;
  device?: string;
  /** 2525 symbol code from `__milsym`, when the sender chose one. */
  sidc?: string;
  /** ATAK icon-set path from `<usericon iconsetpath>`. */
  iconPath?: string;
  /** Metres per second and degrees true. */
  speed?: number;
  course?: number;
  /** Callsign of whoever placed the item. */
  creator?: string;
  stroke?: TakColor;
  strokeWidth?: number;
  fill?: TakColor;
  strokeStyle?: StrokeStyle;
  /** Circle or ellipse in metres and degrees; the geometry is the centre point. */
  ellipse?: { major: number; minor: number; angle: number };
  /** ATAK's tactical overlay on a rectangle: each side drawn in its own colour (`<tog enabled="1"/>`). */
  tacticalOverlay?: true;
  /** ATAK's per-drawing switch for name and measurement labels on lines and shapes. */
  labelsOn?: boolean;
  /** The sender asked for the marker's name not to be shown. */
  hideLabel?: true;
  /** A route's named points (start, checkpoints, end); unnamed control points stay hidden. */
  waypoints?: { name: string; position: Position }[];
  /** The area a sensor point of interest covers on the ground. */
  footprint?: Position[];
  /** Range-and-bearing line from the item's point; the geometry runs to its end. */
  rangeBearing?: { range: number; bearing: number; northRef: "T" | "M" | "G" };
  /** The user disconnected from TAK; ATAK keeps them, greyed out. */
  offline?: true;
  /** A change in a plan in this browser, not (yet) on TAK. */
  draft?: true;
  event: CotEvent;
};

export type TakChange =
  | { kind: "upsert"; item: TakItem }
  | { kind: "delete"; uid: string; time: number }
  | { kind: "offline"; uid: string; time: number };

const MAP_TYPE_PREFIXES = ["a-", "b-m-p", "b-m-r", "u-d-", "u-rb-a"];
const STROKE_STYLES: StrokeStyle[] = ["solid", "dashed", "dotted", "outlined"];
const EARTH_RADIUS_M = 6_371_008.8;
const CIRCLE_TYPES = ["u-d-c-c", "u-d-c-e"];
const UNKNOWN_HAE = 9_999_999;

const num = (value: string | null | undefined): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** ATAK stores colours as signed 32-bit ARGB integers. */
export const argbToColor = (value: string | null | undefined): TakColor | undefined => {
  const n = num(value);
  if (n === undefined) return undefined;
  const argb = n >>> 0;
  const hex = (argb & 0xffffff).toString(16).padStart(6, "0");
  return { color: `#${hex}`, opacity: Math.round(((argb >>> 24) / 255) * 100) / 100 };
};

const parsePoint = (point: string | null): Position | undefined => {
  const [lat, lon] = (point ?? "").split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lon as number, lat as number] : undefined;
};

const geometryFor = (type: string, point: Position, links: Element[]): TakGeometry => {
  const vertices = links.flatMap((l) => {
    const p = parsePoint(l.getAttribute("point"));
    return p ? [p] : [];
  });
  if (vertices.length < 2) return { type: "Point", coordinates: point };
  if (type === "b-m-r") return { type: "LineString", coordinates: vertices };
  const [first, last] = [vertices[0], vertices.at(-1)];
  // ATAK: closed when there are more than two points and the last repeats the first.
  const closed = vertices.length > 2 && first?.[0] === last?.[0] && first?.[1] === last?.[1];
  if (type === "u-d-r" || closed) {
    return {
      type: "Polygon",
      coordinates: [closed ? vertices : [...vertices, vertices[0] as Position]],
    };
  }
  return { type: "LineString", coordinates: vertices };
};

/** The point `range` metres from `from` along `bearing` degrees, on a sphere. */
export const destination = ([lon, lat]: Position, range: number, bearing: number): Position => {
  const rad = Math.PI / 180;
  const d = range / EARTH_RADIUS_M;
  const b = bearing * rad;
  const lat1 = lat * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon * rad +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [lon2 / rad, lat2 / rad];
};

// ponytail: northRef 0/1/2 → true/magnetic/grid is inferred from ATAK's settings order, unverified on the wire.
const NORTH_REF = ["T", "M", "G"] as const;

const ellipseOf = (type: string, el: Element | undefined): TakItem["ellipse"] => {
  const major = num(el?.getAttribute("major"));
  if (!CIRCLE_TYPES.includes(type) || !major) return undefined;
  return {
    major,
    minor: num(el?.getAttribute("minor")) ?? major,
    angle: num(el?.getAttribute("angle")) ?? 0,
  };
};

const parseDetail = (xml: string): Element | undefined => {
  const doc = new DOMParser().parseFromString(`<detail>${xml}</detail>`, "application/xml");
  return doc.getElementsByTagName("parsererror").length > 0 ? undefined : doc.documentElement;
};

/** Interprets a CoT event as a map change; null for anything that isn't one. */
export const toChange = (event: CotEvent): TakChange | null => {
  const { uid, type, time } = event;
  // A bogus far-future time would win every newest-wins comparison for this uid forever.
  if (!uid || !type || !Number.isSafeInteger(time) || time <= 0) return null;
  const detail = parseDetail(event.detail);
  if (!detail) return null;
  const child = (name: string) => childNamed(detail, name);
  const attr = (name: string, attribute: string) =>
    child(name)?.getAttribute(attribute) ?? undefined;
  const links = Array.from(detail.children).filter((el) => el.tagName === "link");

  if (type === "t-x-d-d") {
    const target = links[0]?.getAttribute("uid");
    if (!target) return null;
    // TAK Server announces a client disconnect as a delete of its contact
    // without __forcedelete; ATAK keeps the contact, greyed out.
    const disconnect = links[0]?.getAttribute("relation") === "p-p" && !child("__forcedelete");
    return { kind: disconnect ? "offline" : "delete", uid: target, time };
  }
  if (!MAP_TYPE_PREFIXES.some((p) => type.startsWith(p))) return null;

  const parent = links.find((l) => l.getAttribute("relation") === "p-p");
  const value = (name: string) => attr(name, "value");
  const labelsOnEl = child("labels_on");
  const strokeStyle = value("strokeStyle") as StrokeStyle | undefined;
  const range = num(value("range"));
  const bearing = num(value("bearing"));
  const rangeBearing =
    type.startsWith("u-rb-a") && range !== undefined && bearing !== undefined
      ? { range, bearing, northRef: NORTH_REF[num(value("northRef")) ?? 0] ?? "T" }
      : undefined;
  const footprint = Array.from(child("shape")?.getElementsByTagName("vertex") ?? []).flatMap(
    (v) => {
      const lat = num(v.getAttribute("lat"));
      const lon = num(v.getAttribute("lon"));
      return lat === undefined || lon === undefined ? [] : [[lon, lat] as Position];
    },
  );
  const waypoints = links.flatMap((l) => {
    const position = parsePoint(l.getAttribute("point"));
    const name = l.getAttribute("callsign");
    return l.getAttribute("type")?.startsWith("b-m-p-w") && name && position
      ? [{ name, position }]
      : [];
  });
  const device = [attr("takv", "platform"), attr("takv", "version")].filter(Boolean).join(" ");
  const ellipse = child("shape") && childNamed(child("shape") as Element, "ellipse");

  const item: TakItem = {
    uid,
    type,
    time,
    stale: event.stale || time,
    geometry: rangeBearing
      ? {
          type: "LineString",
          coordinates: [
            [event.lon, event.lat],
            destination([event.lon, event.lat], rangeBearing.range, rangeBearing.bearing),
          ],
        }
      : geometryFor(type, [event.lon, event.lat], links),
    hae: event.hae === UNKNOWN_HAE ? undefined : event.hae,
    callsign: attr("contact", "callsign"),
    team: attr("__group", "name"),
    role: attr("__group", "role"),
    remarks: child("remarks")?.textContent || undefined,
    battery: num(attr("status", "battery")),
    device: device || undefined,
    // ATAK writes single-point symbols to __milicon, multi-point graphics to __milsym.
    sidc: (attr("__milsym", "id") ?? attr("__milicon", "id"))?.replaceAll("*", "-"),
    iconPath: attr("usericon", "iconsetpath"),
    speed: num(attr("track", "speed")),
    course: num(attr("track", "course")),
    creator: parent?.getAttribute("parent_callsign") ?? undefined,
    stroke: argbToColor(
      value("strokeColor") ?? attr("link_attr", "color") ?? attr("color", "argb") ?? value("color"),
    ),
    strokeWidth: num(value("strokeWeight") ?? attr("link_attr", "stroke")),
    strokeStyle: strokeStyle && STROKE_STYLES.includes(strokeStyle) ? strokeStyle : undefined,
    fill: argbToColor(value("fillColor")),
    ellipse: ellipseOf(type, ellipse),
    // A bare <labels_on/> means on; circles label their radius unless told not to.
    labelsOn: labelsOnEl
      ? labelsOnEl.getAttribute("value") !== "false"
      : CIRCLE_TYPES.includes(type) || undefined,
    hideLabel: child("hideLabel") ? true : undefined,
    tacticalOverlay: type === "u-d-r" && attr("tog", "enabled") === "1" ? true : undefined,
    waypoints: waypoints.length ? waypoints : undefined,
    footprint: new Set(footprint.map(String)).size >= 3 ? footprint : undefined,
    rangeBearing,
    event,
  };
  for (const key of Object.keys(item) as (keyof TakItem)[]) {
    if (item[key] === undefined || item[key] === "") delete item[key];
  }
  return { kind: "upsert", item };
};

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
  /** For a sensor point of interest (b-m-p-s-p-i): the uid of the sensor looking at it. */
  sensorUid?: string;
  /** What a camera on the item sees, drawn as ATAK's field-of-view cone. */
  sensor?: Sensor;
  /** A drone's flight state, as the UAS Tool reports it in `<vehicle>`. */
  vehicle?: Vehicle;
  /** A live video feed from the item, as ATAK's `__video` detail announces it. */
  video?: { url: string; alias?: string };
  /** ATAK's range rings around the point: each ring's radius in metres, innermost first. */
  rangeRings?: number[];
  /** ATAK's bullseye: a bearing circle around the point that positions are called from. */
  bullseye?: Bullseye;
  /** Range-and-bearing line from the item's point; the geometry runs to its end. */
  rangeBearing?: { range: number; bearing: number; northRef: "T" | "M" | "G" };
  /** ATAK's `__geofence`: the shape is a fence that alerts when watched items cross it. */
  geofence?: Geofence;
  /** An ATAK emergency alert (b-a-*): what kind, and the callsign of who raised it. */
  emergency?: { kind: string; from: string };
  /** The user disconnected from TAK; ATAK keeps them, greyed out. */
  offline?: true;
  /** A change in a plan in this browser, not (yet) on TAK. */
  draft?: true;
  event: CotEvent;
};

export const GEOFENCE_TRIGGERS = ["Entry", "Exit", "Both"] as const;
export const GEOFENCE_MONITORS = ["TAKUsers", "Friendly", "Hostile", "Custom", "All"] as const;

export type Geofence = {
  trigger: (typeof GEOFENCE_TRIGGERS)[number];
  /** Which items it watches; "Custom" is a hand-picked list ATAK keeps on the device. */
  monitor: (typeof GEOFENCE_MONITORS)[number];
  /** Whether the fence is being monitored. */
  tracking: boolean;
};

export type Sensor = {
  /** Degrees true. */
  azimuth: number;
  /** Horizontal field of view in degrees. */
  fov: number;
  /** Ground range in metres. */
  range: number;
  model?: string;
  fill: TakColor;
  stroke: TakColor;
};

export type Vehicle = {
  flying: boolean;
  /** Percent left of the battery's full capacity. */
  battery?: number;
  // ponytail: assumed seconds (DJI SDK's unit); unverified against a drone in the air.
  flightTime?: number;
  /** Maker, e.g. "DJI". */
  make?: string;
  /** The TAK user flying it, from the `p-p` link. */
  operatorUid?: string;
};

export type Bullseye = {
  /** Metres. */
  radius: number;
  /** Bearings labelled in mils instead of degrees. */
  mils: boolean;
  northRef: "T" | "M" | "G";
  /** Bearings read from the edge in to the centre, i.e. reversed. */
  edgeToCenter: boolean;
  /** Range rings inside the circle, when shown. */
  rings?: { spacing: number; count: number };
};

export type TakChange =
  | { kind: "upsert"; item: TakItem }
  | { kind: "delete"; uid: string; time: number }
  | { kind: "offline"; uid: string; time: number };

const MAP_TYPE_PREFIXES = ["a-", "b-a-", "b-m-p", "b-m-r", "u-d-", "u-rb-a", "u-r-b-"];
export const RANGE_RINGS_TYPE = "u-r-b-c-c";
export const BULLSEYE_TYPE = "u-r-b-bullseye";
const EMERGENCY_CANCEL = "b-a-o-can";
export const GEOFENCE_BREACH_TYPE = "b-a-g";
/** ATAK's names for its emergency types, for alerts that don't name themselves. */
const EMERGENCY_KIND: Record<string, string> = {
  "b-a-o-tbl": "911 Alert",
  "b-a-o-pan": "Ring The Bell",
  "b-a-o-opn": "Troops In Contact",
  [GEOFENCE_BREACH_TYPE]: "Geo-fence Breached",
};
const STROKE_STYLES: StrokeStyle[] = ["solid", "dashed", "dotted", "outlined"];
const EARTH_RADIUS_M = 6_371_008.8;
const CIRCLE_TYPES = ["u-d-c-c", "u-d-c-e"];
const UNKNOWN_HAE = 9_999_999;
const SPI_TYPE = "b-m-p-s-p-i";
const SENSOR_DEFAULT_STROKE: TakColor = { color: "#cccccc", opacity: 1 };

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

/** MapLibre throws on a latitude past ±90 when centring on it. */
const isOnEarth = ([lon, lat]: Position) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

const parsePoint = (point: string | null): Position | undefined => {
  const [lat, lon] = (point ?? "").split(",").map(Number);
  const position: Position = [lon as number, lat as number];
  return isOnEarth(position) ? position : undefined;
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
/** Metres per unit, by the abbreviations of ATAK's distance units (`Span`). */
const METRES_PER_UNIT: Record<string, number> = {
  m: 1,
  km: 1000,
  nm: 1852,
  mi: 1609.344,
  yd: 0.9144,
  ft: 0.3048,
};

const ellipseOf = (type: string, el: Element | undefined): TakItem["ellipse"] => {
  const major = num(el?.getAttribute("major"));
  if (!CIRCLE_TYPES.includes(type) || !major) return undefined;
  return {
    major,
    minor: num(el?.getAttribute("minor")) ?? major,
    angle: num(el?.getAttribute("angle")) ?? 0,
  };
};

/** ATAK writes one `<ellipse>` per ring inside `<shape>`. */
// Ring counts arrive from anyone on TAK; past this they're noise, and unbounded they'd hang the map.
const MAX_RINGS = 50;

const rangeRingsOf = (type: string, shape: Element | undefined): number[] | undefined => {
  if (type !== RANGE_RINGS_TYPE || !shape) return undefined;
  const radii = Array.from(shape.children)
    .filter((el) => el.tagName === "ellipse")
    .flatMap((el) => num(el.getAttribute("major")) ?? [])
    .filter((radius) => radius > 0)
    .sort((a, b) => a - b)
    .slice(0, MAX_RINGS);
  return radii.length ? radii : undefined;
};

const bullseyeOf = (type: string, el: Element | undefined): Bullseye | undefined => {
  if (type !== BULLSEYE_TYPE || !el) return undefined;
  const flag = (name: string) => el.getAttribute(name) === "true";
  // ponytail: distances read as given in distanceUnits (metres when absent); unverified against ATAK's own units.
  const radius = num(el.getAttribute("distance"));
  const toMetres = METRES_PER_UNIT[el.getAttribute("distanceUnits")?.toLowerCase() ?? "m"] ?? 1;
  if (!radius || radius <= 0) return undefined;
  const spacing = num(el.getAttribute("ringDist"));
  const count = num(el.getAttribute("ringNumber"));
  const showRings = flag("hasRangeRings") && flag("rangeRingVisible");
  const northRef = el.getAttribute("bearingRef");
  return {
    radius: radius * toMetres,
    mils: flag("mils"),
    northRef: northRef === "M" || northRef === "G" ? northRef : "T",
    edgeToCenter: flag("edgeToCenter"),
    rings:
      showRings && spacing && spacing > 0 && count && count >= 1
        ? { spacing: spacing * toMetres, count: Math.min(Math.floor(count), MAX_RINGS) }
        : undefined,
  };
};

const geofenceOf = (el: Element | undefined): Geofence | undefined => {
  if (!el) return undefined;
  // CloudTAK writes "Enter" where ATAK writes "Entry".
  const trigger = el.getAttribute("trigger")?.replace(/^Enter$/, "Entry");
  const monitor = el.getAttribute("monitor");
  return {
    trigger: GEOFENCE_TRIGGERS.find((t) => t === trigger) ?? "Entry",
    monitor: GEOFENCE_MONITORS.find((m) => m === monitor) ?? "TAKUsers",
    tracking: el.getAttribute("tracking") === "true",
  };
};

const colorChannel = (value: number) =>
  Math.round(Math.min(Math.max(value, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0");

/** As ATAK's SensorDetailHandler: no cone without azimuth, fov and range, or when hideFov is present at all. */
const sensorOf = (el: Element | undefined): Sensor | undefined => {
  const get = (name: string) => num(el?.getAttribute(name));
  const azimuth = get("azimuth");
  const fov = get("fov");
  const range = get("range");
  if (!el || azimuth === undefined || fov === undefined || range === undefined) return;
  if (el.hasAttribute("hideFov")) return;
  if (!(fov > 0 && fov <= 360) || !(range > 0)) return;
  const [red, green, blue] = ["fovRed", "fovGreen", "fovBlue"].map((c) =>
    colorChannel(get(c) ?? 1),
  );
  return {
    azimuth,
    fov,
    range,
    model: el.getAttribute("model") || undefined,
    fill: { color: `#${red}${green}${blue}`, opacity: get("fovAlpha") ?? 0.3 },
    stroke: argbToColor(el.getAttribute("strokeColor")) ?? SENSOR_DEFAULT_STROKE,
  };
};

const vehicleOf = (
  el: Element | undefined,
  operatorUid: string | undefined,
): Vehicle | undefined => {
  if (!el) return undefined;
  const get = (name: string) => num(el.getAttribute(name));
  const remaining = get("batteryRemainingCapacity");
  const max = get("batteryMaxCapacity");
  return {
    flying: el.getAttribute("isFlying") === "true",
    battery:
      remaining !== undefined && max ? Math.round(Math.min(remaining / max, 1) * 100) : undefined,
    flightTime: get("flightTime"),
    make: el.getAttribute("type") || undefined,
    operatorUid,
  };
};

/** As ATAK's ConnectionEntryBase.getURL, without the player options it appends. */
const connectionUrl = (entry: Element): string | undefined => {
  const address = entry.getAttribute("address");
  if (!address) return undefined;
  const protocol = entry.getAttribute("protocol") ?? "raw";
  if (protocol === "raw" || address.includes("://")) return address;
  const port = num(entry.getAttribute("port")) ?? -1;
  const path = entry.getAttribute("path") ?? "";
  const separator = path && !path.startsWith("/") && !path.startsWith("?") ? "/" : "";
  return `${protocol}://${address}${port === -1 ? "" : `:${port}`}${separator}${path}`;
};

const videoOf = (el: Element | undefined): TakItem["video"] => {
  if (!el) return undefined;
  const entry = childNamed(el, "ConnectionEntry");
  const url = el.getAttribute("url") || (entry && connectionUrl(entry));
  return url ? { url, alias: entry?.getAttribute("alias") || undefined } : undefined;
};

const parseDetail = (xml: string): Element | undefined => {
  const doc = new DOMParser().parseFromString(`<detail>${xml}</detail>`, "application/xml");
  return doc.getElementsByTagName("parsererror").length > 0 ? undefined : doc.documentElement;
};

export const MAX_CLOCK_AHEAD_MS = 60 * 60 * 1000;

/** Interprets a CoT event as a map change; null for anything that isn't one. */
export const toChange = (event: CotEvent): TakChange | null => {
  const { uid, type, time } = event;
  // A bogus far-future time would win every newest-wins comparison for this uid forever,
  // so a delete or edit dated ahead could freeze an item; a device clock off by more is ignored.
  if (!uid || !type || !Number.isSafeInteger(time) || time <= 0) return null;
  if (time > Date.now() + MAX_CLOCK_AHEAD_MS || !isOnEarth([event.lon, event.lat])) return null;
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
  // ATAK cancels an alert by re-sending its uid as b-a-o-can; until then it stays up.
  if (type === EMERGENCY_CANCEL || attr("emergency", "cancel") === "true") {
    return { kind: "delete", uid, time };
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
      return lat === undefined || lon === undefined || !isOnEarth([lon, lat])
        ? []
        : [[lon, lat] as Position];
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
  const callsign = attr("contact", "callsign");

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
    callsign,
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
    rangeRings: rangeRingsOf(type, child("shape")),
    bullseye: bullseyeOf(type, child("bullseye")),
    // A bare <labels_on/> means on; circles label their radius unless told not to.
    labelsOn: labelsOnEl
      ? labelsOnEl.getAttribute("value") !== "false"
      : CIRCLE_TYPES.includes(type) || undefined,
    hideLabel: child("hideLabel") ? true : undefined,
    tacticalOverlay: type === "u-d-r" && attr("tog", "enabled") === "1" ? true : undefined,
    waypoints: waypoints.length ? waypoints : undefined,
    footprint: new Set(footprint.map(String)).size >= 3 ? footprint : undefined,
    sensorUid: type === SPI_TYPE ? (parent?.getAttribute("uid") ?? undefined) : undefined,
    sensor: sensorOf(child("sensor")),
    vehicle: vehicleOf(child("vehicle"), parent?.getAttribute("uid") ?? undefined),
    video: videoOf(child("__video")),
    rangeBearing,
    geofence: geofenceOf(child("__geofence")),
    emergency: type.startsWith("b-a-")
      ? {
          kind: attr("emergency", "type") || (EMERGENCY_KIND[type] ?? "Emergency"),
          // ATAK names the alert "<callsign>-Alert" and puts the plain callsign in <emergency>.
          from: child("emergency")?.textContent?.trim() || callsign || uid,
        }
      : undefined,
    event,
  };
  for (const key of Object.keys(item) as (keyof TakItem)[]) {
    if (item[key] === undefined || item[key] === "") delete item[key];
  }
  return { kind: "upsert", item };
};

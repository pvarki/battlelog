import {
  BULLSEYE_TYPE,
  type CotEvent,
  type Position,
  RANGE_RINGS_TYPE,
  type StrokeStyle,
} from "../cot.ts";
import { bearing, distance } from "../geo.ts";
import { ringRadii } from "../map/rings.ts";

/**
 * New TAK items written the way ATAK writes them (compared against ATAK's own
 * drawings on a TAK server): shapes as u-d-* with one `<link point>` per
 * vertex and a `<creator>`, markers with a `p-p` link naming who placed them.
 */

export type Sender = { uid: string; callsign: string };

export type ShapeStyle = {
  name: string;
  /** #rrggbb */
  stroke: string;
  strokeWeight: number;
  strokeStyle: StrokeStyle;
  /** 0–1; only closed shapes are filled. */
  fillOpacity: number;
  labelsOn: boolean;
  remarks: string;
  /** 2525 tactical graphic code, e.g. G*G*GLB---****X. */
  sidc?: string;
};

export type NewShape =
  | { kind: "line"; points: Position[] }
  | { kind: "polygon"; points: Position[] }
  | { kind: "rectangle"; points: Position[] }
  | { kind: "circle"; centre: Position; radius: number };

export type NewMarker = {
  position: Position;
  name: string;
  remarks: string;
  /**
   * "spot" is ATAK's coloured dot, "icon" an icon-set icon, "symbol" a chosen
   * 2525 symbol; the rest are plain 2525 units by affiliation.
   */
  kind: "spot" | "icon" | "symbol" | "f" | "h" | "n" | "u";
  /** Spot marker colour, #rrggbb. */
  color: string;
  /** For "icon": the ATAK icon-set path and the CoT type the set gives it. */
  icon?: { path: string; type?: string };
  /** For "symbol": the 2525D code and the CoT type ATAK derives from it. */
  symbol?: { sidc: string; type: string };
};

const DAY_MS = 86_400_000;
const RANGE_BEARING_RED = -65536;
const UNKNOWN = 9_999_999;
const SHAPE_TYPE = {
  line: "u-d-f",
  polygon: "u-d-f",
  rectangle: "u-d-r",
  circle: "u-d-c-c",
} as const;

export const escapeXml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** #rrggbb and 0–1 opacity as ATAK's signed 32-bit ARGB integer. */
export const toArgb = (hex: string, opacity = 1): number => {
  const rgb = Number.parseInt(hex.replace("#", ""), 16) & 0xffffff;
  return (Math.round(opacity * 255) << 24) | rgb | 0;
};

const iso = (ms: number) => new Date(ms).toISOString();

const base = (uid: string, type: string, [lon, lat]: Position, now: number, lifetime: number) => ({
  uid,
  type,
  how: "h-e",
  time: now,
  start: now,
  stale: now + lifetime,
  lat,
  lon,
  hae: UNKNOWN,
  ce: UNKNOWN,
  le: UNKNOWN,
});

const remarksXml = (remarks: string) => `<remarks>${escapeXml(remarks)}</remarks>`;

const creatorXml = (sender: Sender, now: number) =>
  `<creator uid="${escapeXml(sender.uid)}" callsign="${escapeXml(sender.callsign)}" time="${iso(now)}" type="a-f-G-U-C"/>`;

const centreOf = (points: Position[]): Position => {
  const sum = points.reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
};

export const newShapeEvent = (
  shape: NewShape,
  style: ShapeStyle,
  sender: Sender,
  now = Date.now(),
  uid: string = crypto.randomUUID(),
): CotEvent => {
  const closed = shape.kind !== "line";
  const stroke = toArgb(style.stroke);
  const link = ([lon, lat]: Position) => `<link point="${lat},${lon}"/>`;
  // ATAK closes a polygon by repeating its first vertex; rectangles list four corners.
  const vertices =
    shape.kind === "circle"
      ? ""
      : (shape.kind === "polygon" ? [...shape.points, shape.points[0] as Position] : shape.points)
          .map(link)
          .join("");
  const geometry =
    shape.kind === "circle"
      ? `<shape><ellipse major="${shape.radius}" minor="${shape.radius}" angle="360"/></shape>`
      : vertices;
  const at = shape.kind === "circle" ? shape.centre : centreOf(shape.points);
  const detail = [
    `<contact callsign="${escapeXml(style.name)}"/>`,
    geometry,
    style.sidc ? `<__milsym id="${escapeXml(style.sidc)}"/>` : "",
    `<strokeColor value="${stroke}"/>`,
    `<strokeWeight value="${style.strokeWeight}"/>`,
    `<strokeStyle value="${style.strokeStyle}"/>`,
    closed ? `<fillColor value="${toArgb(style.stroke, style.fillOpacity)}"/>` : "",
    `<color value="${stroke}"/>`,
    `<labels_on value="${style.labelsOn}"/>`,
    `<__shapeExtras cpvis="true" editable="true"/>`,
    creatorXml(sender, now),
    remarksXml(style.remarks),
    "<archive/>",
  ].join("");
  return { ...base(uid, SHAPE_TYPE[shape.kind], at, now, DAY_MS), detail };
};

export const newMarkerEvent = (
  marker: NewMarker,
  sender: Sender,
  now = Date.now(),
  uid: string = crypto.randomUUID(),
): CotEvent => {
  const { kind, icon, symbol } = marker;
  // ATAK's icon palette places white-tinted icons as unknown ground unless the set names a type.
  const type =
    kind === "spot"
      ? "b-m-p-s-m"
      : kind === "icon"
        ? (icon?.type ?? "a-u-G")
        : kind === "symbol"
          ? (symbol?.type ?? "a-u-G")
          : `a-${kind}-G`;
  const look =
    kind === "spot"
      ? `<color argb="${toArgb(marker.color)}"/><usericon iconsetpath="COT_MAPPING_SPOTMAP/b-m-p-s-m/${toArgb(marker.color)}"/>`
      : kind === "icon" && icon
        ? `<color argb="-1"/><usericon iconsetpath="${escapeXml(icon.path)}"/>`
        : kind === "symbol" && symbol
          ? `<__milsym id="${escapeXml(symbol.sidc)}"/><__milicon id="${escapeXml(symbol.sidc)}"/>`
          : "";
  const detail = [
    `<contact callsign="${escapeXml(marker.name)}"/>`,
    `<link uid="${escapeXml(sender.uid)}" relation="p-p" type="a-f-G-U-C" parent_callsign="${escapeXml(sender.callsign)}" production_time="${iso(now)}"/>`,
    look,
    remarksXml(marker.remarks),
    "<archive/>",
  ].join("");
  return { ...base(uid, type, marker.position, now, 365 * DAY_MS), detail };
};

/**
 * A range-and-bearing line from `from` to `to`, as ATAK's R&B tool writes it
 * (takcot "Range & Bearing - Line"): metres, degrees, true north.
 */
export const newRangeBearingEvent = (
  [from, to]: [Position, Position],
  name: string,
  now = Date.now(),
  uid: string = crypto.randomUUID(),
): CotEvent => {
  const detail = [
    `<range value="${distance(from, to)}"/>`,
    `<bearing value="${bearing(from, to)}"/>`,
    `<inclination value="0.0"/>`,
    `<rangeUnits value="1"/>`,
    `<bearingUnits value="0"/>`,
    `<northRef value="0"/>`,
    `<strokeColor value="${RANGE_BEARING_RED}"/>`,
    `<strokeWeight value="3.0"/>`,
    `<contact callsign="${escapeXml(name)}"/>`,
    remarksXml(""),
    "<archive/>",
    `<labels_on value="false"/>`,
    `<color value="${RANGE_BEARING_RED}"/>`,
  ].join("");
  return { ...base(uid, "u-rb-a", from, now, DAY_MS), detail };
};

export type NewRangeRings = {
  centre: Position;
  name: string;
  /** #rrggbb */
  color: string;
  remarks: string;
  /** Metres between rings, and from the centre to the first. */
  spacing: number;
  count: number;
};

/** Range rings as ATAK's R&B circle: one `<ellipse>` per ring in `<shape>`. */
export const newRangeRingsEvent = (
  rings: NewRangeRings,
  sender: Sender,
  now = Date.now(),
  uid: string = crypto.randomUUID(),
): CotEvent => {
  const stroke = toArgb(rings.color);
  const ellipses = ringRadii(rings.spacing, rings.count)
    .map((radius) => `<ellipse major="${radius}" minor="${radius}" angle="360"/>`)
    .join("");
  const detail = [
    `<contact callsign="${escapeXml(rings.name)}"/>`,
    `<shape>${ellipses}</shape>`,
    `<strokeColor value="${stroke}"/>`,
    `<strokeWeight value="2.0"/>`,
    `<fillColor value="${toArgb(rings.color, 0)}"/>`,
    `<color value="${stroke}"/>`,
    `<labels_on value="true"/>`,
    `<__shapeExtras cpvis="true" editable="true"/>`,
    creatorXml(sender, now),
    remarksXml(rings.remarks),
    "<archive/>",
  ].join("");
  return { ...base(uid, RANGE_RINGS_TYPE, rings.centre, now, DAY_MS), detail };
};

export type NewBullseye = {
  centre: Position;
  name: string;
  /** #rrggbb */
  color: string;
  remarks: string;
  /** Metres. */
  radius: number;
  mils: boolean;
  edgeToCenter: boolean;
  rings?: { spacing: number; count: number };
};

/** ATAK's bullseye: a `<bullseye>` detail on the centre point, metres and true north. */
export const newBullseyeEvent = (
  bullseye: NewBullseye,
  sender: Sender,
  now = Date.now(),
  uid: string = crypto.randomUUID(),
): CotEvent => {
  const { rings } = bullseye;
  const attributes = [
    `mils="${bullseye.mils}"`,
    `distance="${bullseye.radius}"`,
    `bearingRef="T"`,
    `bullseyeUID="${crypto.randomUUID()}"`,
    `distanceUnits="m"`,
    `edgeToCenter="${bullseye.edgeToCenter}"`,
    `rangeRingVisible="${!!rings}"`,
    `hasRangeRings="${!!rings}"`,
    rings ? `ringDist="${rings.spacing}" ringNumber="${rings.count}"` : "",
    `title="${escapeXml(bullseye.name)}"`,
  ].filter(Boolean);
  const detail = [
    `<contact callsign="${escapeXml(bullseye.name)}"/>`,
    `<bullseye ${attributes.join(" ")}/>`,
    `<strokeColor value="${toArgb(bullseye.color)}"/>`,
    creatorXml(sender, now),
    remarksXml(bullseye.remarks),
    "<archive/>",
  ].join("");
  return { ...base(uid, BULLSEYE_TYPE, bullseye.centre, now, DAY_MS), detail };
};

export type NewRoute = {
  points: Position[];
  name: string;
  /** #rrggbb */
  color: string;
  remarks: string;
  /** One per point; an empty name makes the point an unnamed control point. */
  waypointNames: string[];
};

/** ATAK's default checkpoint names: start point, numbered checkpoints, release point. */
export const defaultWaypointNames = (routeName: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) =>
    i === 0 ? `${routeName} SP` : i === count - 1 ? "VDO" : `CP${i}`,
  );

/** A route as ATAK writes one (takcot Route.cot): checkpoints as linked points, the event at 0,0. */
export const newRouteEvent = (
  route: NewRoute,
  sender: Sender,
  now = Date.now(),
  uid: string = crypto.randomUUID(),
): CotEvent => {
  const color = toArgb(route.color);
  const links = route.points.map(([lon, lat], i) => {
    const name = route.waypointNames[i]?.trim() ?? "";
    return `<link uid="${crypto.randomUUID()}" callsign="${escapeXml(name)}" type="${name ? "b-m-p-w" : "b-m-p-c"}" point="${lat},${lon}" remarks="" relation="c"/>`;
  });
  const detail = [
    ...links,
    `<link_attr planningmethod="Infil" color="${color}" method="Driving" prefix="CP" type="Vehicle" stroke="3" direction="Infil" routetype="Primary" order="Ascending Check Points"/>`,
    `<strokeColor value="${color}"/>`,
    `<strokeWeight value="3.0"/>`,
    "<__routeinfo><__navcues/></__routeinfo>",
    `<contact callsign="${escapeXml(route.name)}"/>`,
    remarksXml(route.remarks),
    "<archive/>",
    `<labels_on value="false"/>`,
    `<color value="${color}"/>`,
    creatorXml(sender, now),
  ].join("");
  return { ...base(uid, "b-m-r", [0, 0], now, DAY_MS), detail };
};

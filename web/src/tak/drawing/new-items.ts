import type { CotEvent, Position, StrokeStyle } from "../cot.ts";

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
  /** "spot" is ATAK's coloured dot; the rest are 2525 units by affiliation. */
  kind: "spot" | "f" | "h" | "n" | "u";
  /** Spot marker colour, #rrggbb. */
  color: string;
};

const DAY_MS = 86_400_000;
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
    `<creator uid="${escapeXml(sender.uid)}" callsign="${escapeXml(sender.callsign)}" time="${iso(now)}" type="a-f-G-U-C"/>`,
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
  const spot = marker.kind === "spot";
  const type = spot ? "b-m-p-s-m" : `a-${marker.kind}-G`;
  const detail = [
    `<contact callsign="${escapeXml(marker.name)}"/>`,
    `<link uid="${escapeXml(sender.uid)}" relation="p-p" type="a-f-G-U-C" parent_callsign="${escapeXml(sender.callsign)}" production_time="${iso(now)}"/>`,
    spot
      ? `<color argb="${toArgb(marker.color)}"/><usericon iconsetpath="COT_MAPPING_SPOTMAP/b-m-p-s-m/${toArgb(marker.color)}"/>`
      : "",
    remarksXml(marker.remarks),
    "<archive/>",
  ].join("");
  return { ...base(uid, type, marker.position, now, 365 * DAY_MS), detail };
};

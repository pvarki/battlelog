import { XMLParser } from "fast-xml-parser";

type Position = [lon: number, lat: number];

export type TakGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };

export type TakColor = { color: string; opacity: number };

export type TakFeature = {
  type: "Feature";
  id: string;
  geometry: TakGeometry;
  properties: {
    cotType: string;
    callsign?: string;
    time: string;
    stale: string;
    remarks?: string;
    team?: string;
    role?: string;
    battery?: number;
    device?: string;
    /** Contact disconnected from TAK; ATAK greys it out. */
    offline?: true;
    /** Circle radius in metres; geometry is the centre point. */
    radius?: number;
    stroke?: TakColor;
    strokeWidth?: number;
    fill?: TakColor;
    /** Named route checkpoints (start point, objective…), in route order. */
    checkpoints?: { name: string; coordinates: Position }[];
  };
};

export type CotChange =
  | { kind: "upsert"; feature: TakFeature }
  | { kind: "delete"; uid: string; time: string }
  | { kind: "offline"; uid: string; time: string };

const MAP_TYPE_PREFIXES = ["a-", "b-m-p", "b-m-r", "u-d-"];
const CIRCLE_TYPES = ["u-d-c-c", "u-d-c-e"];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => name === "link",
});

type Attrs = Record<string, string | undefined>;
type Detail = Record<string, (Attrs & { "#text"?: string }) | Attrs[] | string | undefined>;

const attrs = (detail: Detail, key: string): Attrs => {
  const value = detail[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

const num = (value: string | undefined): number | undefined => {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** ATAK stores colours as signed 32-bit ARGB integers. */
export const argbToColor = (value: string | undefined): TakColor | undefined => {
  const n = num(value);
  if (n === undefined) return undefined;
  const argb = n >>> 0;
  const hex = (argb & 0xffffff).toString(16).padStart(6, "0");
  return { color: `#${hex}`, opacity: Math.round(((argb >>> 24) / 255) * 100) / 100 };
};

const parsePoint = (point: string | undefined): Position | undefined => {
  const [lat, lon] = (point ?? "").split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lon as number, lat as number] : undefined;
};

const text = (value: Detail[string]): string | undefined => {
  if (typeof value === "string") return value || undefined;
  if (value && !Array.isArray(value)) return value["#text"] || undefined;
  return undefined;
};

const geometryFor = (cotType: string, point: Position, links: Attrs[]): TakGeometry => {
  const vertices = links.flatMap((l) => {
    const p = parsePoint(l.point);
    return p ? [p] : [];
  });
  if (vertices.length < 2) return { type: "Point", coordinates: point };
  if (cotType === "b-m-r") return { type: "LineString", coordinates: vertices };
  const [first, last] = [vertices[0], vertices.at(-1)];
  const closed = first?.[0] === last?.[0] && first?.[1] === last?.[1];
  if (cotType === "u-d-r" || closed) {
    return {
      type: "Polygon",
      coordinates: [closed ? vertices : [...vertices, vertices[0] as Position]],
    };
  }
  return { type: "LineString", coordinates: vertices };
};

const validTime = (value: string | undefined) =>
  value && Number.isFinite(Date.parse(value)) ? value : undefined;

/** Returns null for anything that isn't a well-formed map change; never throws. */
export const parseCot = (xml: string): CotChange | null => {
  let event: unknown;
  try {
    event = parser.parse(xml)?.event;
  } catch {
    return null;
  }
  return toChange(event);
};

const toChange = (event: any): CotChange | null => {
  const ev: Attrs | undefined = event && typeof event === "object" ? event : undefined;
  const uid = ev?.uid;
  const cotType = ev?.type;
  const time = validTime(ev?.time);
  if (!ev || !uid || !cotType || !time) return null;
  const detail: Detail = event.detail && typeof event.detail === "object" ? event.detail : {};
  const links = Array.isArray(detail.link) ? detail.link : [];

  if (cotType === "t-x-d-d") {
    const link = links[0];
    if (!link?.uid) return null;
    // TAK Server announces a client disconnect as a delete of its contact
    // without __forcedelete; ATAK keeps the contact, greyed out.
    const disconnect = link.relation === "p-p" && !("__forcedelete" in detail);
    return { kind: disconnect ? "offline" : "delete", uid: link.uid, time };
  }
  if (!MAP_TYPE_PREFIXES.some((p) => cotType.startsWith(p))) return null;

  const pt: Attrs = event.point ?? {};
  const lat = num(pt.lat);
  const lon = num(pt.lon);
  if (lat === undefined || lon === undefined) return null;

  const contact = attrs(detail, "contact");
  const group = attrs(detail, "__group");
  const takv = attrs(detail, "takv");
  const shape = detail.shape && typeof detail.shape === "object" ? (detail.shape as Detail) : {};
  const device = [takv.platform, takv.version].filter(Boolean).join(" ");
  const checkpoints =
    cotType === "b-m-r"
      ? links.flatMap((l) => {
          const coordinates = parsePoint(l.point);
          return l.callsign && coordinates ? [{ name: l.callsign, coordinates }] : [];
        })
      : [];

  const properties: TakFeature["properties"] = {
    cotType,
    callsign: contact.callsign || undefined,
    time,
    stale: validTime(ev.stale) ?? time,
    remarks: text(detail.remarks),
    team: group.name,
    role: group.role,
    battery: num(attrs(detail, "status").battery),
    device: device || undefined,
    radius: CIRCLE_TYPES.includes(cotType) ? num(attrs(shape, "ellipse").major) : undefined,
    stroke: argbToColor(attrs(detail, "strokeColor").value ?? attrs(detail, "color").argb),
    strokeWidth: num(attrs(detail, "strokeWeight").value),
    fill: argbToColor(attrs(detail, "fillColor").value),
    checkpoints: checkpoints.length ? checkpoints : undefined,
  };
  for (const key of Object.keys(properties) as (keyof typeof properties)[]) {
    if (properties[key] === undefined) delete properties[key];
  }

  return {
    kind: "upsert",
    feature: {
      type: "Feature",
      id: uid,
      geometry: geometryFor(cotType, [lon, lat], links),
      properties,
    },
  };
};

/** Splits a TCP stream buffer into complete `<event>` documents plus the unfinished tail. */
export const splitEvents = (buffer: string): { events: string[]; rest: string } => {
  const events: string[] = [];
  const re = /<event[\s>][\s\S]*?<\/event>/g;
  let end = 0;
  for (let m = re.exec(buffer); m; m = re.exec(buffer)) {
    events.push(m[0]);
    end = re.lastIndex;
  }
  const rest = buffer.slice(end);
  const start = rest.indexOf("<event");
  // A chunk can end mid-tag ("<eve"), so keep enough tail to complete it.
  return { events, rest: start === -1 ? rest.slice(-"<event".length) : rest.slice(start) };
};

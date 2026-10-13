import { type CotEvent, destination, type Position, type TakColor, type TakItem } from "../cot.ts";
import {
  defaultWaypointNames,
  escapeXml,
  newMarkerEvent,
  newRouteEvent,
  newShapeEvent,
  type Sender,
  type ShapeStyle,
} from "../drawing/new-items.ts";

/**
 * KML and GPX overlays to and from ATAK drawings: placemarks and waypoints
 * become spot markers, lines and tracks u-d-f lines, polygons closed u-d-f
 * shapes and GPX routes b-m-r routes, keeping names, descriptions and KML
 * colours.
 */

const MAX_FEATURES = 10_000;
const DEFAULT_COLOR = "#ffffff";
const DEFAULT_WEIGHT = 3;
const CIRCLE_STEPS = 64;

const parseXml = (xml: string): Document => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("Not a readable file");
  return doc;
};

/** Matches by local name, so prefixed (`kml:Placemark`) and default-namespace files read alike. */
const descendants = (root: Document | Element, name: string): Element[] =>
  Array.from(root.getElementsByTagName("*")).filter((el) => el.localName === name);

const child = (parent: Element | undefined, name: string): Element | undefined =>
  parent && Array.from(parent.children).find((el) => el.localName === name);

const childText = (parent: Element | undefined, name: string) =>
  child(parent, name)?.textContent?.trim() ?? "";

/** KML and GPX descriptions are often HTML; remarks are plain text. */
const plainText = (html: string) =>
  html.includes("<")
    ? (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").trim()
    : html;

const isPosition = ([lon, lat]: number[]) =>
  Number.isFinite(lon) &&
  Number.isFinite(lat) &&
  Math.abs(lat as number) <= 90 &&
  Math.abs(lon as number) <= 180;

/** KML's `lon,lat[,alt]` tuples separated by whitespace. */
const kmlCoordinates = (text: string | null | undefined): Position[] =>
  (text ?? "")
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(",").map(Number))
    .filter(isPosition)
    .map(([lon, lat]) => [lon, lat] as Position);

/** KML colours are `aabbggrr` hex. */
const fromKmlColor = (text: string): TakColor | undefined => {
  if (!/^[0-9a-f]{8}$/i.test(text)) return undefined;
  const [a, b, g, r] = (text.match(/../g) as string[]).map((h) => Number.parseInt(h, 16));
  const hex = [r, g, b].map((v) => (v as number).toString(16).padStart(2, "0")).join("");
  return { color: `#${hex}`, opacity: Math.round(((a as number) / 255) * 100) / 100 };
};

const toKmlColor = ({ color, opacity }: TakColor) => {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  const [r, g, b] = [1, 3, 5].map((i) => color.slice(i, i + 2));
  return `${hex(Math.round(opacity * 255))}${b}${g}${r}`;
};

type KmlStyle = { icon?: TakColor; line?: TakColor; width?: number; fill?: TakColor };

/** A placemark's own style, or the shared one it points to (a StyleMap's "normal" style). */
const styleResolver = (doc: Document) => {
  const byId = new Map<string, Element>();
  for (const el of [...descendants(doc, "Style"), ...descendants(doc, "StyleMap")]) {
    const id = el.getAttribute("id");
    if (id) byId.set(id, el);
  }
  const resolve = (url: string, depth = 0): Element | undefined => {
    const el = byId.get(url.replace(/^#/, ""));
    if (el?.localName !== "StyleMap" || depth > 2) return el;
    const normal = Array.from(el.children).find((pair) => childText(pair, "key") === "normal");
    return child(normal, "Style") ?? resolve(childText(normal, "styleUrl"), depth + 1);
  };
  return (placemark: Element): KmlStyle => {
    const style = child(placemark, "Style") ?? resolve(childText(placemark, "styleUrl"));
    const color = (name: string) => fromKmlColor(childText(child(style, name), "color"));
    const fillOff = childText(child(style, "PolyStyle"), "fill") === "0";
    return {
      icon: color("IconStyle"),
      line: color("LineStyle"),
      width: Number(childText(child(style, "LineStyle"), "width")) || undefined,
      fill: fillOff ? undefined : color("PolyStyle"),
    };
  };
};

type Feature =
  | { kind: "marker"; name: string; remarks: string; position: Position; color?: string }
  | { kind: "line" | "polygon"; name: string; remarks: string; points: Position[]; style: KmlStyle }
  | {
      kind: "route";
      name: string;
      remarks: string;
      points: { position: Position; name: string }[];
    };

const toEvents = (features: Feature[], sender: Sender, now: number): CotEvent[] => {
  if (features.length > MAX_FEATURES) throw new Error("Too many features to import");
  return features.map((f) => {
    if (f.kind === "marker") {
      const marker = { ...f, kind: "spot" as const, color: f.color ?? DEFAULT_COLOR };
      return newMarkerEvent(marker, sender, now);
    }
    if (f.kind === "route") {
      const defaults = defaultWaypointNames(f.name, f.points.length);
      const route = {
        ...f,
        color: DEFAULT_COLOR,
        points: f.points.map((p) => p.position),
        waypointNames: f.points.map((p, i) => p.name || (defaults[i] ?? "")),
      };
      return newRouteEvent(route, sender, now);
    }
    const style: ShapeStyle = {
      name: f.name,
      remarks: f.remarks,
      stroke: f.style.line?.color ?? DEFAULT_COLOR,
      strokeWeight: f.style.width ?? DEFAULT_WEIGHT,
      strokeStyle: "solid",
      fillOpacity: f.style.fill?.opacity ?? 0,
      labelsOn: false,
    };
    return newShapeEvent({ kind: f.kind, points: f.points }, style, sender, now);
  });
};

/** A ring without the repeated closing vertex, as newShapeEvent expects a polygon. */
const openRing = (ring: Position[]) => {
  const [first, last] = [ring[0], ring.at(-1)];
  return ring.length > 1 && first?.[0] === last?.[0] && first?.[1] === last?.[1]
    ? ring.slice(0, -1)
    : ring;
};

export const kmlToEvents = (xml: string, sender: Sender, now = Date.now()): CotEvent[] => {
  const doc = parseXml(xml);
  const styleOf = styleResolver(doc);
  const features = descendants(doc, "Placemark").flatMap((placemark): Feature[] => {
    const name = childText(placemark, "name");
    const remarks = plainText(childText(placemark, "description"));
    const style = styleOf(placemark);
    const points = descendants(placemark, "Point").flatMap((point) =>
      kmlCoordinates(child(point, "coordinates")?.textContent).slice(0, 1),
    );
    const lines = descendants(placemark, "LineString")
      .map((line) => kmlCoordinates(child(line, "coordinates")?.textContent))
      .filter((coords) => coords.length >= 2);
    const polygons = descendants(placemark, "Polygon")
      .map((polygon) => {
        const ring = child(child(polygon, "outerBoundaryIs"), "LinearRing");
        return openRing(kmlCoordinates(child(ring, "coordinates")?.textContent));
      })
      .filter((ring) => ring.length >= 3);
    return [
      ...points.map((position) => ({
        kind: "marker" as const,
        name,
        remarks,
        position,
        color: (style.icon ?? style.line)?.color,
      })),
      ...lines.map((points) => ({ kind: "line" as const, name, remarks, points, style })),
      ...polygons.map((points) => ({ kind: "polygon" as const, name, remarks, points, style })),
    ];
  });
  return toEvents(features, sender, now);
};

const gpxPoint = (el: Element): Position | undefined => {
  const position = [Number(el.getAttribute("lon")), Number(el.getAttribute("lat"))];
  return isPosition(position) ? (position as Position) : undefined;
};

const gpxRemarks = (el: Element) => plainText(childText(el, "desc") || childText(el, "cmt"));

export const gpxToEvents = (xml: string, sender: Sender, now = Date.now()): CotEvent[] => {
  const doc = parseXml(xml);
  const noStyle: KmlStyle = {};
  const waypoints = descendants(doc, "wpt").flatMap((wpt): Feature[] => {
    const position = gpxPoint(wpt);
    return position
      ? [{ kind: "marker", name: childText(wpt, "name"), remarks: gpxRemarks(wpt), position }]
      : [];
  });
  const tracks = descendants(doc, "trk").flatMap((trk): Feature[] => {
    const segments = descendants(trk, "trkseg")
      .map((seg) =>
        descendants(seg, "trkpt")
          .map(gpxPoint)
          .filter((p) => p !== undefined),
      )
      .filter((points) => points.length >= 2);
    const name = childText(trk, "name");
    return segments.map((points, i) => ({
      kind: "line",
      name: segments.length > 1 ? `${name} ${i + 1}` : name,
      remarks: gpxRemarks(trk),
      points,
      style: noStyle,
    }));
  });
  const routes = descendants(doc, "rte").flatMap((rte): Feature[] => {
    const points = descendants(rte, "rtept").flatMap((pt) => {
      const position = gpxPoint(pt);
      return position ? [{ position, name: childText(pt, "name") }] : [];
    });
    return points.length >= 2
      ? [{ kind: "route", name: childText(rte, "name"), remarks: gpxRemarks(rte), points }]
      : [];
  });
  return toEvents([...waypoints, ...tracks, ...routes], sender, now);
};

const ellipseRing = (item: TakItem, { major, minor, angle }: NonNullable<TakItem["ellipse"]>) => {
  const centre = item.geometry.coordinates as Position;
  return Array.from({ length: CIRCLE_STEPS + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / CIRCLE_STEPS;
    // As the map draws it: the major axis points north before turning by `angle`.
    const [north, east] = [major * Math.cos(t), minor * Math.sin(t)];
    const bearing = (Math.atan2(east, north) * 180) / Math.PI + angle;
    return destination(centre, Math.hypot(east, north), bearing);
  });
};

const kmlCoords = (positions: Position[]) =>
  positions.map(([lon, lat]) => `${lon},${lat}`).join(" ");

const kmlGeometry = (item: TakItem): string => {
  const ring = (positions: Position[]) =>
    `<Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(positions)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  const { geometry } = item;
  if (item.ellipse) return ring(ellipseRing(item, item.ellipse));
  if (geometry.type === "Point")
    return `<Point><coordinates>${kmlCoords([geometry.coordinates])}</coordinates></Point>`;
  if (geometry.type === "LineString")
    return `<LineString><coordinates>${kmlCoords(geometry.coordinates)}</coordinates></LineString>`;
  return ring(geometry.coordinates[0] ?? []);
};

const kmlStyle = (item: TakItem) => {
  const stroke = item.stroke && toKmlColor(item.stroke);
  if (!stroke) return "";
  const fill = item.fill ? toKmlColor(item.fill) : undefined;
  return `<Style><IconStyle><color>${stroke}</color></IconStyle><LineStyle><color>${stroke}</color><width>${item.strokeWidth ?? DEFAULT_WEIGHT}</width></LineStyle><PolyStyle>${fill ? `<color>${fill}</color>` : "<fill>0</fill>"}</PolyStyle></Style>`;
};

/** The items as one KML document, readable by Google Earth, QGIS and ATAK. */
export const itemsToKml = (name: string, items: TakItem[]): string => {
  const placemarks = items
    .map(
      (item) =>
        `<Placemark><name>${escapeXml(item.callsign ?? item.uid)}</name>${item.remarks ? `<description>${escapeXml(item.remarks)}</description>` : ""}${kmlStyle(item)}${kmlGeometry(item)}</Placemark>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(name)}</name>${placemarks}</Document></kml>`;
};

export const kmlBlob = (name: string, items: TakItem[]) =>
  new Blob([itemsToKml(name, items)], { type: "application/vnd.google-earth.kml+xml" });

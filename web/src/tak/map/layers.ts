import type { Feature, FeatureCollection } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Position, TakItem } from "../cot.ts";
import { hasPosition, labelOf, statusOf } from "../items.ts";
import { groupOf, isHidden } from "../overlays.ts";
import {
  arrowhead,
  iconFor,
  type LabelStyle,
  labelImage,
  type MapImage,
  pruneLabels,
  referenceDot,
} from "./symbols.ts";
import { pruneTactical, tacticalFeatures } from "./tactical.ts";

/**
 * Items as the GeoJSON sources the map draws, following ATAK's conventions:
 * marker names under the icon; closed shapes get a centre dot carrying their
 * name; open lines and measurements are labelled only when the drawing has
 * labels switched on; route waypoints show as named dots.
 */

export type Sources = {
  points: FeatureCollection;
  shapes: FeatureCollection;
  /** Names that ATAK shows only when zoomed in. */
  markerLabels: FeatureCollection;
  /** Line names and measurements, shown at every zoom. */
  lineLabels: FeatureCollection;
  /** Map-aligned decorations such as range-and-bearing arrowheads. */
  decorations: FeatureCollection;
  /** MIL-STD-2525 tactical graphics, rendered from drawings that carry a symbol code. */
  tactical: FeatureCollection;
};

const EARTH_RADIUS_M = 6_371_008.8;
const CIRCLE_STEPS = 64;
const DEFAULT_STROKE = "#ffffff";
const RANGE_BEARING_COLOR = "#ff0000";
const LABEL_GAP = 2;
// Drawn last = on top: people over units over markers.
const DRAW_ORDER = [
  "shapes",
  "navigation",
  "other",
  "markers/spot",
  "markers/unknown",
  "markers/neutral",
  "markers/friendly",
  "markers/hostile",
  "markers/team",
  "alerts",
];

const RAD = Math.PI / 180;

/** Ground distance in metres, haversine. */
const distance = ([lon1, lat1]: Position, [lon2, lat2]: Position) => {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
};

export const formatDistance = (metres: number): string =>
  metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(metres < 10_000 ? 2 : 1)} km`;

/**
 * Rotation for text along a segment on a map turned to `bearing`, flipped so
 * it never reads upside down on screen.
 */
const textAngle = ([lon1, lat1]: Position, [lon2, lat2]: Position, bearing: number) => {
  const east = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * RAD);
  const north = lat2 - lat1;
  const onScreen = ((((-Math.atan2(north, east) / RAD - bearing + 540) % 360) + 360) % 360) - 180;
  const upright = onScreen > 90 ? onScreen - 180 : onScreen < -90 ? onScreen + 180 : onScreen;
  return upright + bearing;
};

/**
 * ATAK's tactical overlay colours for a rectangle's four sides (`ring` closed,
 * first edge = front), worked out the way ATAK does: white front, black back,
 * and red/green on whichever sides are left/right of the front.
 */
export const tacticalOverlayColors = (ring: Position[]): string[] => {
  const mids = [0, 1, 2, 3].map((i) => midpoint(ring[i] as Position, ring[i + 1] as Position));
  const [front, right, back, left] = mids as [Position, Position, Position, Position];
  const heading = compassBearing(back, front);
  const toFront = (from: Position) => (((compassBearing(from, front) - heading) % 360) + 360) % 360;
  const leftIsLeft = toFront(left) < 180 && toFront(right) > 180;
  return [
    "#ffffff",
    leftIsLeft ? "#00ff00" : "#ff0000",
    "#000000",
    leftIsLeft ? "#ff0000" : "#00ff00",
  ];
};

const compassBearing = ([lon1, lat1]: Position, [lon2, lat2]: Position) => {
  const east = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * RAD);
  return (((Math.atan2(east, lat2 - lat1) / RAD) % 360) + 360) % 360;
};

const midpoint = ([lon1, lat1]: Position, [lon2, lat2]: Position): Position => [
  (lon1 + lon2) / 2,
  (lat1 + lat2) / 2,
];

/**
 * An ellipse as a polygon: `major` and `minor` are semi-axes in metres, `angle`
 * turns the major axis clockwise from north. Equirectangular is accurate
 * enough at drawing sizes.
 */
const ellipseRing = (
  [lon, lat]: Position,
  { major, minor, angle }: NonNullable<TakItem["ellipse"]>,
) => {
  const metresPerDegLat = (EARTH_RADIUS_M * Math.PI) / 180;
  const metresPerDegLon = metresPerDegLat * Math.cos(lat * RAD);
  const turn = angle * RAD;
  const ring: Position[] = [];
  for (let i = 0; i <= CIRCLE_STEPS; i++) {
    const a = (i / CIRCLE_STEPS) * 2 * Math.PI;
    const alongMajor = major * Math.cos(a);
    const alongMinor = minor * Math.sin(a);
    const north = alongMajor * Math.cos(turn) - alongMinor * Math.sin(turn);
    const east = alongMajor * Math.sin(turn) + alongMinor * Math.cos(turn);
    ring.push([lon + east / metresPerDegLon, lat + north / metresPerDegLat]);
  }
  return ring;
};

/** The average of a ring's corners; good enough to place a name inside a drawn area. */
const centreOf = (ring: Position[]): Position => {
  const corners = ring.slice(0, -1);
  const sum = corners.reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
  return [sum[0] / corners.length, sum[1] / corners.length];
};

const point = (coordinates: Position, properties: Record<string, unknown>): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties,
});

export const toSources = (
  map: MapLibreMap,
  items: TakItem[],
  hidden: ReadonlySet<string>,
  now: number,
  /** The map's rotation, so line labels stay readable when it turns. */
  bearing: number,
): Sources => {
  const points: Feature[] = [];
  const shapes: Feature[] = [];
  const markerLabels: Feature[] = [];
  const lineLabels: Feature[] = [];
  const decorations: Feature[] = [];
  const tactical: Feature[] = [];

  // Set per item below; drafts get a dashed outline so they can't pass for what TAK has.
  let draft = false;
  const icon = (uid: string, at: Position, image: MapImage, order: number) =>
    points.push(point(at, { uid, icon: image.id, offset: image.offset, order, draft }));

  /** A name centred under an icon, as ATAK draws marker labels. */
  const nameUnder = (uid: string, at: Position, text: string, under: MapImage) => {
    const label = labelImage(map, text);
    const iconBottom = under.height / 2 + under.offset[1];
    markerLabels.push(
      point(at, {
        uid,
        icon: label.id,
        offset: [0, iconBottom + LABEL_GAP + label.height / 2],
      }),
    );
  };

  const alongLine = (
    uid: string,
    from: Position,
    to: Position,
    text: string,
    style: LabelStyle = "marker",
  ) =>
    lineLabels.push(
      point(midpoint(from, to), {
        uid,
        icon: labelImage(map, text, style).id,
        rotate: textAngle(from, to, bearing),
      }),
    );

  for (const item of items) {
    const group = groupOf(item);
    if (isHidden(group, hidden) || !hasPosition(item)) continue;
    const { uid } = item;
    draft = item.draft === true;
    const stale = statusOf(item, now) !== "online";
    const name = labelOf(item);
    const stroke = item.stroke?.color ?? (item.rangeBearing ? RANGE_BEARING_COLOR : DEFAULT_STROKE);
    const g = item.geometry;

    const graphic = g.type === "Point" ? undefined : tacticalFeatures(map, item, bearing);
    if (graphic) {
      tactical.push(...graphic);
      continue;
    }

    if (g.type === "Point" && !item.ellipse) {
      const image = iconFor(map, item, stale);
      icon(uid, g.coordinates, image, DRAW_ORDER.indexOf(group.slice(0, 2).join("/")));
      if (!item.hideLabel) nameUnder(uid, g.coordinates, name, image);
      if (item.footprint) {
        shapes.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[...item.footprint, item.footprint[0] as Position]],
          },
          properties: {
            uid,
            stroke,
            strokeOpacity: 1,
            strokeWidth: 2,
            strokeStyle: "solid",
            fill: stroke,
            fillOpacity: 0.15,
          },
        });
      }
      continue;
    }

    const ring =
      g.type === "Point" && item.ellipse
        ? ellipseRing(g.coordinates, item.ellipse)
        : g.type === "Polygon"
          ? (g.coordinates[0] ?? [])
          : undefined;
    const line = g.type === "LineString" ? g.coordinates : undefined;
    const overlay =
      item.tacticalOverlay && ring?.length === 5 ? tacticalOverlayColors(ring) : undefined;
    shapes.push({
      type: "Feature",
      geometry: ring
        ? { type: "Polygon", coordinates: [ring] }
        : { type: "LineString", coordinates: line ?? [] },
      properties: {
        uid,
        draft,
        stroke,
        // With ATAK's tactical overlay the sides are drawn below, one colour each.
        strokeOpacity: overlay ? 0 : (item.stroke?.opacity ?? 1),
        strokeWidth: item.strokeWidth ?? 3,
        strokeStyle: item.rangeBearing ? "outlined" : (item.strokeStyle ?? "solid"),
        // ATAK fills closed shapes only.
        fill: item.fill?.color ?? DEFAULT_STROKE,
        fillOpacity: ring ? (item.fill?.opacity ?? 0) : 0,
      },
    });

    for (const [i, color] of (overlay ?? []).entries()) {
      shapes.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [ring?.[i] as Position, ring?.[i + 1] as Position],
        },
        properties: {
          uid,
          draft,
          stroke: color,
          strokeOpacity: 1,
          strokeWidth: (item.strokeWidth ?? 3) + 1,
          strokeStyle: "outlined",
          fillOpacity: 0,
        },
      });
    }

    if (ring) {
      const centre = g.type === "Point" ? g.coordinates : centreOf(ring);
      const dot = referenceDot(map, stroke);
      icon(uid, centre, dot, -1);
      nameUnder(uid, centre, name, dot);
      if (item.labelsOn && item.ellipse) {
        const { major, minor } = item.ellipse;
        const text =
          major === minor
            ? formatDistance(major)
            : `W: ${formatDistance(minor * 2)}  L: ${formatDistance(major * 2)}`;
        const top = ring.reduce((a, b) => (b[1] > a[1] ? b : a));
        lineLabels.push(point(top, { uid, icon: labelImage(map, text).id, rotate: 0 }));
      }
      if (item.labelsOn && item.type === "u-d-r") {
        for (let i = 0; i + 1 < ring.length; i++) {
          const [a, b] = [ring[i] as Position, ring[i + 1] as Position];
          alongLine(uid, a, b, formatDistance(distance(a, b)));
        }
      }
      continue;
    }

    if (!line || line.length < 2) continue;
    if (item.rangeBearing) {
      const { range, bearing: heading, northRef } = item.rangeBearing;
      const [from, to] = [line[0] as Position, line[1] as Position];
      const arrow = heading >= 180 ? "←" : "→";
      alongLine(
        uid,
        from,
        to,
        `${arrow} ${Math.round(heading)}°${northRef}   ${formatDistance(range)}`,
        "emphasis",
      );
      decorations.push(point(to, { uid, icon: arrowhead(map, stroke).id, rotate: heading }));
      continue;
    }
    if (item.labelsOn) {
      const middle = Math.floor((line.length - 1) / 2);
      alongLine(uid, line[middle] as Position, line[middle + 1] as Position, name);
    }
    for (const waypoint of item.waypoints ?? []) {
      const dot = referenceDot(map, stroke);
      icon(uid, waypoint.position, dot, -1);
      nameUnder(uid, waypoint.position, waypoint.name, dot);
    }
  }

  const collection = (features: Feature[]): FeatureCollection => ({
    type: "FeatureCollection",
    features,
  });
  pruneTactical();
  pruneLabels(map);
  return {
    points: collection(points),
    shapes: collection(shapes),
    markerLabels: collection(markerLabels),
    lineLabels: collection(lineLabels),
    decorations: collection(decorations),
    tactical: collection(tactical),
  };
};

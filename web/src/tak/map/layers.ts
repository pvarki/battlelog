import type { Feature, FeatureCollection } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Position, TakItem } from "../cot.ts";
import { hasPosition, statusOf } from "../items.ts";
import { groupOf, isHidden } from "../overlays.ts";
import { iconsFor } from "./symbols.ts";

/** Items as the two GeoJSON sources the map draws: icons for points, lines and areas for shapes. */

const EARTH_RADIUS_M = 6_371_008.8;
const CIRCLE_STEPS = 64;
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

/**
 * An ellipse as a polygon: `major` and `minor` are semi-axes in metres, `angle`
 * turns the major axis clockwise from north. Equirectangular is accurate
 * enough at drawing sizes.
 */
const ellipse = (
  [lon, lat]: Position,
  { major, minor, angle }: NonNullable<TakItem["ellipse"]>,
): Position[][] => {
  const metresPerDegLat = (EARTH_RADIUS_M * Math.PI) / 180;
  const metresPerDegLon = metresPerDegLat * Math.cos((lat * Math.PI) / 180);
  const turn = (angle * Math.PI) / 180;
  const ring: Position[] = [];
  for (let i = 0; i <= CIRCLE_STEPS; i++) {
    const a = (i / CIRCLE_STEPS) * 2 * Math.PI;
    const alongMajor = major * Math.cos(a);
    const alongMinor = minor * Math.sin(a);
    const north = alongMajor * Math.cos(turn) - alongMinor * Math.sin(turn);
    const east = alongMajor * Math.sin(turn) + alongMinor * Math.cos(turn);
    ring.push([lon + east / metresPerDegLon, lat + north / metresPerDegLat]);
  }
  return [ring];
};

const shapeFeature = (item: TakItem, faded: boolean): Feature | undefined => {
  const g = item.geometry;
  const geometry =
    g.type === "Point" && item.ellipse
      ? { type: "Polygon" as const, coordinates: ellipse(g.coordinates, item.ellipse) }
      : g;
  if (geometry.type === "Point") return undefined;
  return {
    type: "Feature",
    geometry,
    properties: {
      uid: item.uid,
      faded,
      stroke: item.stroke?.color ?? "#ffffff",
      strokeOpacity: item.stroke?.opacity ?? 1,
      strokeWidth: item.strokeWidth ?? 3,
      fill: item.fill?.color ?? "#ffffff",
      fillOpacity: geometry.type === "Polygon" ? (item.fill?.opacity ?? 0) : 0,
    },
  };
};

const pointFeature = (map: MapLibreMap, item: TakItem, faded: boolean): Feature => {
  const { labelled, bare } = iconsFor(map, item);
  return {
    type: "Feature",
    geometry: item.geometry,
    properties: {
      uid: item.uid,
      faded,
      icon: labelled.id,
      offset: labelled.offset,
      bareIcon: bare.id,
      bareOffset: bare.offset,
      order: DRAW_ORDER.indexOf(groupOf(item).slice(0, 2).join("/")),
    },
  };
};

export const toSources = (
  map: MapLibreMap,
  items: TakItem[],
  hidden: ReadonlySet<string>,
  now: number,
): { points: FeatureCollection; shapes: FeatureCollection } => {
  const points: Feature[] = [];
  const shapes: Feature[] = [];
  for (const item of items) {
    if (isHidden(groupOf(item), hidden) || !hasPosition(item)) continue;
    const faded = statusOf(item, now) !== "online";
    const shape = shapeFeature(item, faded);
    if (shape) shapes.push(shape);
    else points.push(pointFeature(map, item, faded));
  }
  return {
    points: { type: "FeatureCollection", features: points },
    shapes: { type: "FeatureCollection", features: shapes },
  };
};

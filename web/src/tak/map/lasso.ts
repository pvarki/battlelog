import type { MapGeoJSONFeature, Map as MapLibreMap } from "maplibre-gl";

/**
 * Lasso selection: the user draws a freehand outline on the map and every
 * item with a point inside it is picked. Screen pixels throughout, so the
 * map's rotation and pitch don't matter.
 */

export type ScreenPoint = [x: number, y: number];

/** Even-odd ray casting; the outline closes itself between its last and first point. */
export const insideOutline = ([x, y]: ScreenPoint, outline: ScreenPoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i] as ScreenPoint;
    const [xj, yj] = outline[j] as ScreenPoint;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const verticesOf = (feature: MapGeoJSONFeature): [number, number][] => {
  const g = feature.geometry;
  switch (g.type) {
    case "Point":
      return [g.coordinates as [number, number]];
    case "MultiPoint":
    case "LineString":
      return g.coordinates as [number, number][];
    case "MultiLineString":
    case "Polygon":
      return g.coordinates.flat() as [number, number][];
    case "MultiPolygon":
      return g.coordinates.flat(2) as [number, number][];
    default:
      return [];
  }
};

/** The uids of the features with any vertex inside the outline. */
export const uidsInOutline = (
  map: MapLibreMap,
  features: MapGeoJSONFeature[],
  outline: ScreenPoint[],
): string[] => {
  // ponytail: vertices only, so a long line crossing the lasso without a vertex inside is missed.
  const uids = new Set<string>();
  for (const feature of features) {
    const uid = feature.properties?.uid;
    if (typeof uid !== "string" || uids.has(uid)) continue;
    const hit = verticesOf(feature).some((lngLat) => {
      const { x, y } = map.project(lngLat);
      return insideOutline([x, y], outline);
    });
    if (hit) uids.add(uid);
  }
  return [...uids];
};

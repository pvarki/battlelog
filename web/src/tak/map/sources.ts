import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

/** The GeoJSON sources an item is drawn on, each `${prefix}-${name}` on the map. */
export const SOURCE_NAMES = [
  "points",
  "shapes",
  // Names that ATAK shows only when zoomed in.
  "markerLabels",
  // Line names and measurements, shown at every zoom.
  "lineLabels",
  // Map-aligned decorations such as range-and-bearing arrowheads.
  "decorations",
  // MIL-STD-2525 tactical graphics, rendered from drawings that carry a symbol code.
  "tactical",
] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];

export const EMPTY_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

export const geoJsonSource = (map: MapLibreMap, id: string): GeoJSONSource => {
  const source = map.getSource<GeoJSONSource>(id);
  if (source?.type !== "geojson") throw new Error(`The map has no GeoJSON source "${id}"`);
  return source;
};

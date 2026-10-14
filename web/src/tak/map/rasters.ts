import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapSource } from "./basemaps.ts";

const shownRasters = new WeakMap<MapLibreMap, Map<string, string>>();

/** Puts `source` on the raster layer `id` (or takes it off), keeping basemap below overlay below the rest. */
const showRaster = (map: MapLibreMap, id: "basemap" | "overlay", source: MapSource | undefined) => {
  const shown = shownRasters.get(map) ?? new Map<string, string>();
  shownRasters.set(map, shown);
  const key = source ? JSON.stringify(source.spec) : "";
  if (shown.get(id) === key) return;
  shown.set(id, key);
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  if (!source) return;
  map.addSource(id, source.spec);
  const layers = map.getStyle().layers.map((l) => l.id);
  const below = id === "basemap" ? layers[0] : layers[layers.indexOf("basemap") + 1];
  map.addLayer({ id, type: "raster", source: id }, below);
};

export const showRasters = (
  map: MapLibreMap,
  basemap: MapSource,
  overlay: { source: MapSource; opacity: number } | undefined,
  dim: boolean,
) => {
  showRaster(map, "basemap", basemap);
  showRaster(map, "overlay", overlay?.source);
  for (const id of ["basemap", "overlay"]) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, "raster-brightness-max", dim ? 0.55 : 1);
    map.setPaintProperty(id, "raster-saturation", dim ? -0.4 : 0);
  }
  if (overlay) map.setPaintProperty("overlay", "raster-opacity", overlay.opacity);
};

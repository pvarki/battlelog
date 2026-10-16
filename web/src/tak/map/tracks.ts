import type { Feature, FeatureCollection } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { EMPTY_COLLECTION, geoJsonSource } from "./sources.ts";

export const addTrackLayers = (map: MapLibreMap) => {
  map.addSource("tak-tracks", { type: "geojson", data: EMPTY_COLLECTION });
  map.addLayer({
    id: "tak-track-lines",
    type: "line",
    source: "tak-tracks",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.8 },
  });
  map.addLayer({
    id: "tak-track-crumbs",
    type: "circle",
    source: "tak-tracks",
    filter: ["!=", ["geometry-type"], "LineString"],
    paint: {
      "circle-radius": 2.5,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 0.5,
    },
  });
};

/**
 * Keeps the breadcrumb trails drawn, sending the map only the trails that
 * changed: an unchanged trail keeps its feature object (`trackFeatures`).
 * Re-sending every trail cost MapLibre a serialisation of all their points
 * per update, most of the main thread with long trails shown.
 */
export const useTracks = (map: MapLibreMap | undefined, tracks: FeatureCollection) => {
  const drawn = useRef<{ map: MapLibreMap; features: Map<Feature["id"], Feature> }>(undefined);
  useEffect(() => {
    if (!map) return;
    const source = geoJsonSource(map, "tak-tracks");
    const next = new Map(tracks.features.map((f) => [f.id, f]));
    const before = drawn.current?.map === map ? drawn.current.features : undefined;
    drawn.current = { map, features: next };
    if (!before) return void source.setData(tracks);
    const remove = [...before.keys()].filter(
      (id): id is string | number => id !== undefined && !next.has(id),
    );
    const add = tracks.features.filter((f) => before.get(f.id) !== f);
    if (remove.length || add.length) void source.updateData({ remove, add });
  }, [map, tracks]);
};

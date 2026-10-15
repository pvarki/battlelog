import type { FeatureCollection } from "geojson";
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

/** Keeps the breadcrumb trails drawn, uploading only when they changed. */
export const useTracks = (map: MapLibreMap | undefined, tracks: FeatureCollection) => {
  const drawnTracks = useRef("");
  useEffect(() => {
    const json = JSON.stringify(tracks);
    if (!map || json === drawnTracks.current) return;
    drawnTracks.current = json;
    geoJsonSource(map, "tak-tracks").setData(tracks);
  }, [map, tracks]);
};

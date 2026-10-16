import type { ExpressionSpecification, FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";
import { mgrsGrid } from "./mgrs-grid.ts";
import { EMPTY_COLLECTION, geoJsonSource } from "./sources.ts";
import { labelImage } from "./symbols.ts";

const SOURCE = "mgrs-grid";

export const addMgrsGridLayers = (map: MapLibreMap) => {
  map.addSource(SOURCE, { type: "geojson", data: EMPTY_COLLECTION });
  const lines = {
    type: "line" as const,
    source: SOURCE,
    filter: ["has", "level"] as FilterSpecification,
  };
  const width: ExpressionSpecification = ["match", ["get", "level"], "gzd", 2, "100km", 1.5, 1];
  map.addLayer({
    ...lines,
    id: "mgrs-grid-casings",
    paint: { "line-color": "#000000", "line-opacity": 0.5, "line-width": ["+", width, 1.5] },
  });
  map.addLayer({
    ...lines,
    id: "mgrs-grid-lines",
    paint: { "line-color": "#ffffff", "line-width": width },
  });
  map.addLayer({
    id: "mgrs-grid-labels",
    type: "symbol",
    source: SOURCE,
    filter: ["has", "text"],
    layout: { "icon-image": ["get", "icon"], "icon-anchor": ["get", "anchor"] },
  });
};

/** Redraws the grid for the viewport after every move; returns how to stop. */
const followMgrsGrid = (map: MapLibreMap) => {
  const source = geoJsonSource(map, SOURCE);
  const draw = () => {
    const bounds = map.getBounds();
    const grid = mgrsGrid(
      {
        west: Math.max(bounds.getWest(), -180),
        south: bounds.getSouth(),
        east: Math.min(bounds.getEast(), 180),
        north: bounds.getNorth(),
      },
      map.getZoom(),
    );
    for (const { properties } of grid.features) {
      if (properties?.text) properties.icon = labelImage(properties.text).id;
    }
    source.setData(grid);
  };
  draw();
  map.on("moveend", draw);
  return () => {
    map.off("moveend", draw);
  };
};

export const useMgrsGrid = (map: MapLibreMap | undefined, shown: boolean) => {
  useEffect(() => {
    if (!map) return;
    if (shown) return followMgrsGrid(map);
    geoJsonSource(map, SOURCE).setData(EMPTY_COLLECTION);
  }, [map, shown]);
};

import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { ACCENT, WARNING_COLOR } from "../../theme.ts";
import { LABEL_ZOOM_FILTER } from "./layers.ts";
import { EMPTY_COLLECTION, SOURCE_NAMES } from "./sources.ts";
import { addTacticalLayers } from "./tactical.ts";
import { addTrackLayers } from "./tracks.ts";

// ATAK's dash patterns (6 on / 10 off, 2 on / 14 off) in line-width units for a typical 3–4 px line.
const DASHES: ExpressionSpecification = [
  "match",
  ["get", "strokeStyle"],
  "dashed",
  ["literal", [4, 6]],
  "dotted",
  ["literal", [1, 4]],
  ["literal", [1, 0]],
];

/** The item layers over sources named `${prefix}-…`: "tak" for the picture, "tak-preview" for what's being drawn. */
export const addItemLayers = (map: MapLibreMap, prefix: string) => {
  for (const name of SOURCE_NAMES) {
    if (name !== "tactical")
      map.addSource(`${prefix}-${name}`, { type: "geojson", data: EMPTY_COLLECTION });
  }
  const overlapping = { "icon-allow-overlap": true, "icon-ignore-placement": true } as const;
  map.addLayer({
    id: `${prefix}-shape-fills`,
    type: "fill",
    source: `${prefix}-shapes`,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": ["get", "fill"], "fill-opacity": ["get", "fillOpacity"] },
  });
  // A dashed amber band under the shape's own line, which keeps the style it was drawn with.
  map.addLayer({
    id: `${prefix}-fence-shapes`,
    type: "line",
    source: `${prefix}-shapes`,
    filter: ["==", ["get", "fence"], true],
    paint: {
      "line-color": WARNING_COLOR,
      "line-width": ["+", ["get", "strokeWidth"], 6],
      "line-opacity": 0.7,
      "line-dasharray": ["literal", [2, 1]],
    },
  });
  map.addLayer({
    id: `${prefix}-draft-shapes`,
    type: "line",
    source: `${prefix}-shapes`,
    filter: ["==", ["get", "draft"], true],
    paint: {
      "line-color": ACCENT,
      "line-width": ["+", ["get", "strokeWidth"], 6],
      "line-opacity": 0.7,
      "line-dasharray": ["literal", [1, 1]],
    },
  });
  map.addLayer({
    id: `${prefix}-shape-casings`,
    type: "line",
    source: `${prefix}-shapes`,
    filter: ["==", ["get", "strokeStyle"], "outlined"],
    paint: { "line-color": "#000000", "line-width": ["+", ["get", "strokeWidth"], 2] },
  });
  map.addLayer({
    id: `${prefix}-shape-lines`,
    type: "line",
    source: `${prefix}-shapes`,
    paint: {
      "line-color": ["get", "stroke"],
      "line-width": ["get", "strokeWidth"],
      "line-opacity": ["get", "strokeOpacity"],
      "line-dasharray": DASHES,
    },
  });
  map.addLayer({
    id: `${prefix}-selected-shape`,
    type: "line",
    source: `${prefix}-shapes`,
    filter: ["==", ["get", "uid"], ""],
    paint: { "line-color": ACCENT, "line-width": 6, "line-opacity": 0.6 },
  });
  if (prefix === "tak") addTrackLayers(map);
  addTacticalLayers(map, prefix);
  map.addLayer({
    id: `${prefix}-selected-tactical`,
    type: "line",
    source: `${prefix}-tactical`,
    filter: ["==", ["get", "uid"], ""],
    paint: { "line-color": ACCENT, "line-width": 6, "line-opacity": 0.6 },
  });
  map.addLayer({
    id: `${prefix}-decorations`,
    type: "symbol",
    source: `${prefix}-decorations`,
    layout: {
      ...overlapping,
      "icon-image": ["get", "icon"],
      "icon-offset": ["get", "offset"],
      "icon-rotate": ["get", "rotate"],
      "icon-rotation-alignment": "map",
    },
  });
  map.addLayer({
    id: `${prefix}-line-labels`,
    type: "symbol",
    source: `${prefix}-lineLabels`,
    filter: LABEL_ZOOM_FILTER,
    layout: {
      ...overlapping,
      "icon-image": ["get", "icon"],
      "icon-rotate": ["get", "rotate"],
      "icon-rotation-alignment": "map",
    },
  });
  map.addLayer({
    id: `${prefix}-draft-points`,
    type: "circle",
    source: `${prefix}-points`,
    filter: ["==", ["get", "draft"], true],
    paint: {
      "circle-radius": 15,
      "circle-color": "transparent",
      "circle-stroke-color": ACCENT,
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.8,
    },
  });
  map.addLayer({
    id: `${prefix}-selected-point`,
    type: "circle",
    source: `${prefix}-points`,
    filter: ["==", ["get", "uid"], ""],
    paint: {
      "circle-radius": 18,
      "circle-color": "transparent",
      "circle-stroke-color": ACCENT,
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: `${prefix}-points`,
    type: "symbol",
    source: `${prefix}-points`,
    layout: {
      ...overlapping,
      "icon-image": ["get", "icon"],
      "icon-offset": ["get", "offset"],
      "symbol-sort-key": ["get", "order"],
    },
  });
  map.addLayer({
    id: `${prefix}-marker-labels`,
    type: "symbol",
    source: `${prefix}-markerLabels`,
    filter: LABEL_ZOOM_FILTER,
    layout: { ...overlapping, "icon-image": ["get", "icon"], "icon-offset": ["get", "offset"] },
  });
};

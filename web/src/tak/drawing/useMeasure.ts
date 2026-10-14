import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useState } from "react";
import type { Position } from "../cot.ts";
import type { Cursor } from "../map/cursor.ts";

const SOURCE = "tak-measure";
const COLOR = "#ffcc00";

const lngLat = (e: MapMouseEvent): Position => [e.lngLat.lng, e.lngLat.lat];

/**
 * ATAK's range-and-bearing tool, kept in this browser: each click adds a
 * point, and a rubber band follows the cursor from the last one.
 */
export const useMeasure = (map: MapLibreMap | undefined, cursor: Cursor) => {
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<Position[]>([]);
  /** Measuring the area the points enclose, so the line closes back to the first one. */
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!map || !active) return;
    const empty = { type: "FeatureCollection" as const, features: [] };
    map.addSource(SOURCE, { type: "geojson", data: empty });
    map.addLayer({
      id: "tak-measure-area",
      type: "fill",
      source: SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": COLOR, "fill-opacity": 0.15 },
    });
    map.addLayer({
      id: "tak-measure-line",
      type: "line",
      source: SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": COLOR, "line-width": 3, "line-dasharray": ["literal", [2, 1]] },
    });
    map.addLayer({
      id: "tak-measure-points",
      type: "circle",
      source: SOURCE,
      filter: ["==", ["geometry-type"], "MultiPoint"],
      paint: {
        "circle-radius": 4,
        "circle-color": COLOR,
        "circle-stroke-color": "#000000",
        "circle-stroke-width": 1,
      },
    });
    const onClick = (e: MapMouseEvent) => setPoints((p) => [...p, lngLat(e)]);
    const onMove = () => {
      // After MapCanvas's hover handler, which resets the cursor.
      map.getCanvas().style.cursor = "crosshair";
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    map.doubleClickZoom.disable();
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = "";
      map.removeLayer("tak-measure-area");
      map.removeLayer("tak-measure-line");
      map.removeLayer("tak-measure-points");
      map.removeSource(SOURCE);
    };
  }, [map, active]);

  // The rubber band follows the pointer outside React, so moving doesn't re-render the workspace.
  useEffect(() => {
    if (!active) return;
    const draw = () => {
      const source = map?.getSource(SOURCE) as GeoJSONSource | undefined;
      const at = cursor.get();
      const open = at && points.length ? [...points, at] : points;
      const enclosing = closed && open.length >= 3;
      const line = enclosing ? [...open, open[0] as Position] : open;
      source?.setData({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: {} },
          ...(enclosing
            ? [
                {
                  type: "Feature" as const,
                  geometry: { type: "Polygon" as const, coordinates: [line] },
                  properties: {},
                },
              ]
            : []),
          {
            type: "Feature",
            geometry: { type: "MultiPoint", coordinates: points },
            properties: {},
          },
        ],
      });
    };
    draw();
    return cursor.subscribe(draw);
  }, [map, active, points, closed, cursor]);

  const stop = () => {
    setActive(false);
    setPoints([]);
    setClosed(false);
  };

  return {
    active,
    points,
    closed,
    setClosed,
    start: () => setActive(true),
    stop,
    clear: () => setPoints([]),
  };
};

import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useState } from "react";
import type { Position } from "../cot.ts";

const SOURCE = "tak-measure";
const COLOR = "#ffcc00";

const lngLat = (e: MapMouseEvent): Position => [e.lngLat.lng, e.lngLat.lat];

/**
 * ATAK's range-and-bearing tool, kept in this browser: each click adds a
 * point, and a rubber band follows the cursor from the last one.
 */
export const useMeasure = (map: MapLibreMap | undefined) => {
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<Position[]>([]);
  const [cursor, setCursor] = useState<Position>();

  useEffect(() => {
    if (!map || !active) return;
    const empty = { type: "FeatureCollection" as const, features: [] };
    map.addSource(SOURCE, { type: "geojson", data: empty });
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
      filter: ["!=", ["geometry-type"], "LineString"],
      paint: {
        "circle-radius": 4,
        "circle-color": COLOR,
        "circle-stroke-color": "#000000",
        "circle-stroke-width": 1,
      },
    });
    const onClick = (e: MapMouseEvent) => setPoints((p) => [...p, lngLat(e)]);
    const onMove = (e: MapMouseEvent) => {
      setCursor(lngLat(e));
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
      map.removeLayer("tak-measure-line");
      map.removeLayer("tak-measure-points");
      map.removeSource(SOURCE);
    };
  }, [map, active]);

  useEffect(() => {
    const source = map?.getSource(SOURCE) as GeoJSONSource | undefined;
    const line = cursor && points.length ? [...points, cursor] : points;
    source?.setData({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: {} },
        { type: "Feature", geometry: { type: "MultiPoint", coordinates: points }, properties: {} },
      ],
    });
  }, [map, points, cursor]);

  const stop = () => {
    setActive(false);
    setPoints([]);
    setCursor(undefined);
  };

  return {
    active,
    points,
    /** Where the next point would go; undefined when the cursor is off the map. */
    cursor,
    start: () => setActive(true),
    stop,
    clear: () => setPoints([]),
  };
};

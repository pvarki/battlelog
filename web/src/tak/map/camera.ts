import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";
import type { Position, TakItem } from "../cot.ts";
import type { Bounds } from "../geo.ts";
import { anchorOf, extentOf, hasPosition } from "../items.ts";

const FOCUS_ZOOM = 14;
const FIT_PADDING_PX = 60;
// Close enough for a building-sized shape to fill the view; MML maps go to 19.
const FIT_MAX_ZOOM = 18;

/** Flies to a point at a readable zoom, never zooming out. */
export const flyToPosition = (map: MapLibreMap, position: Position) =>
  map.flyTo({ center: position, zoom: Math.max(map.getZoom(), FOCUS_ZOOM) });

/** A shape fills the view, centred; a marker is flown to at a readable zoom. */
export const centreOnItem = (map: MapLibreMap, item: TakItem) => {
  const extent = extentOf(item);
  if (!extent) return hasPosition(item) && flyToPosition(map, anchorOf(item));
  // Picking may open a panel that narrows the map on the next frame: fit to that map.
  requestAnimationFrame(() => {
    map.resize();
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    map.fitBounds(extent, {
      padding: Math.min(FIT_PADDING_PX, width / 6, height / 6),
      maxZoom: FIT_MAX_ZOOM,
      bearing: map.getBearing(),
    });
  });
};

/** The map's centre and visible area, updated when it stops moving; undefined before the map is up. */
export const useMapView = (map: MapLibreMap | undefined) => {
  const [view, setView] = useState<{ centre: Position; bounds: Bounds }>();
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const b = map.getBounds();
      setView({
        centre: map.getCenter().toArray(),
        bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
      });
    };
    update();
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [map]);
  return view;
};

import type { Map as MapLibreMap } from "maplibre-gl";
import type { Position, TakItem } from "../cot.ts";
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

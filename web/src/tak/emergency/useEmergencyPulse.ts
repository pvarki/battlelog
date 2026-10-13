import { type Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { TakItem } from "../cot.ts";
import { anchorOf } from "../items.ts";

/**
 * A pulsing red ring on the map under each active emergency. DOM markers
 * rather than a map layer so the CSS animation runs without redrawing the
 * map; each is kept across renders so its pulse doesn't restart.
 */
export const useEmergencyPulse = (map: MapLibreMap | undefined, emergencies: TakItem[]) => {
  const markers = useRef(new Map<string, Marker>());

  useEffect(() => {
    if (!map) return;
    const shown = markers.current;
    const active = new Set(emergencies.map((e) => e.uid));
    for (const [uid, marker] of shown) {
      if (!active.has(uid)) {
        marker.remove();
        shown.delete(uid);
      }
    }
    for (const item of emergencies) {
      const existing = shown.get(item.uid);
      if (existing) {
        existing.setLngLat(anchorOf(item));
        continue;
      }
      const element = document.createElement("div");
      element.className = "tak-emergency-pulse";
      shown.set(item.uid, new Marker({ element }).setLngLat(anchorOf(item)).addTo(map));
    }
  }, [map, emergencies]);

  useEffect(
    () => () => {
      for (const marker of markers.current.values()) marker.remove();
      markers.current.clear();
    },
    [],
  );
};

import { notifications } from "@mantine/notifications";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useRef, useState } from "react";
import type { MapSource } from "../map/basemaps.ts";
import { areaPlan, saveArea } from "../map/offline-area.ts";

const DEFAULT_MAX_ZOOM = 19;

/** Saves a map's tiles for what's on screen, for when the network is gone. */
export const useSaveArea = (map: MapLibreMap | undefined) => {
  const [progress, setProgress] = useState<{ source: MapSource; done: number; total: number }>();
  const abort = useRef<AbortController>(undefined);

  const start = async (source: MapSource) => {
    if (!map || progress) return;
    const b = map.getBounds();
    const plan = areaPlan(
      { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
      Math.floor(map.getZoom()),
      source.spec.maxzoom ?? DEFAULT_MAX_ZOOM,
    );
    if (plan.tiles.length === 0) {
      notifications.show({
        color: "warning",
        message: "Zoom in further: this area is too large to save.",
      });
      return;
    }
    abort.current = new AbortController();
    const total = plan.tiles.length;
    setProgress({ source, done: 0, total });
    const failed = await saveArea(
      source,
      plan.tiles,
      (done) => setProgress({ source, done, total }),
      abort.current.signal,
    );
    const cancelled = abort.current.signal.aborted;
    setProgress(undefined);
    if (cancelled) return;
    notifications.show({
      color: failed ? "warning" : "success",
      message: `${source.label}: zoom ${plan.fromZoom}–${plan.toZoom} saved for offline use${failed ? `, ${failed} of ${total} tiles failed` : ""}.`,
    });
  };

  return { progress, start, cancel: () => abort.current?.abort() };
};

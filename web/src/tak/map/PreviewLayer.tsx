import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Position, TakItem } from "../cot.ts";
import type { Drawn, Sketch } from "../drawing/useDrawing.ts";
import { type Cursor, useCursor } from "./cursor.ts";
import { toSources } from "./layers.ts";
import { geoJsonSource, SOURCE_NAMES } from "./sources.ts";
import { onTacticalRendered } from "./tactical.ts";

export type Preview = {
  sketch: Sketch;
  build: (sketch: Drawn | undefined, cursor: Position | undefined) => TakItem[];
};

const NO_GROUPS_HIDDEN = new Set<string>();

/** Draws what's being drawn on the "tak-preview" sources, following the pointer. */
export const PreviewLayer = ({
  map,
  bearing,
  cursor,
  sketch,
  build,
}: { map: MapLibreMap; bearing: number; cursor: Cursor } & Preview) => {
  const shape = useSyncExternalStore(sketch.subscribe, sketch.get);
  const items = build(shape, useCursor(cursor));
  // With nothing being drawn the pointer still moves; an empty preview needs clearing only once.
  const cleared = useRef(false);
  useEffect(() => {
    const draw = () => {
      if (items.length === 0 && cleared.current) return;
      const sources = toSources(map, items, NO_GROUPS_HIDDEN, Date.now(), bearing);
      // Until its graphic is rendered, keep showing the last one rather than flicker to a plain line.
      if (sources.graphicsPending) return;
      for (const name of SOURCE_NAMES) {
        geoJsonSource(map, `tak-preview-${name}`).setData(sources[name]);
      }
      cleared.current = items.length === 0;
    };
    draw();
    return onTacticalRendered(draw);
  }, [map, items, bearing]);
  return null;
};

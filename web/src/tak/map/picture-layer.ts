import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { TakItem } from "../cot.ts";
import { onIconsetsChanged } from "./iconsets.ts";
import { createPictureDrawer } from "./layers.ts";
import { onTacticalRendered } from "./tactical.ts";

const sameMembers = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Keeps the TAK picture drawn on the "tak" item sources. */
export const usePictureLayer = (
  map: MapLibreMap | undefined,
  items: TakItem[],
  hidden: ReadonlySet<string>,
  now: number,
  bearing: number,
) => {
  // What the picture was last drawn from. Every upload makes MapLibre's worker re-tile the
  // whole picture, so a render that changed nothing on the map must not reach it.
  const drawnFrom = useRef<{
    items: TakItem[];
    hidden: ReadonlySet<string>;
    now: number;
    bearing: number;
  }>(undefined);
  const awaitingGraphics = useRef(false);

  const drawPicture = useRef<ReturnType<typeof createPictureDrawer>>(undefined);
  useEffect(() => {
    if (!map) return;
    drawPicture.current ??= createPictureDrawer(map, "tak");
    const draw = () => {
      const { graphicsPending } = (drawPicture.current as ReturnType<typeof createPictureDrawer>)(
        items,
        hidden,
        now,
        bearing,
      );
      drawnFrom.current = { items, hidden, now, bearing };
      awaitingGraphics.current = graphicsPending;
    };
    const last = drawnFrom.current;
    const unchanged =
      last &&
      last.now === now &&
      last.bearing === bearing &&
      sameMembers(last.items, items) &&
      sameMembers([...last.hidden], [...hidden]);
    // A redraw re-tiles the whole picture; mid-drag that costs frames, so it waits for the map to stop.
    let waiting = false;
    const drawWhenStill = () => {
      if (!map.isMoving()) {
        waiting = false;
        draw();
      } else if (!waiting) {
        waiting = true;
        map.once("moveend", drawWhenStill);
      }
    };
    if (!unchanged) drawWhenStill();
    // Graphics and icon-set icons load asynchronously the first time; redraw when they're ready.
    const offTactical = onTacticalRendered(() => {
      if (awaitingGraphics.current) drawWhenStill();
    });
    const offIconsets = onIconsetsChanged(drawWhenStill);
    return () => {
      map.off("moveend", drawWhenStill);
      offTactical();
      offIconsets();
    };
  }, [map, items, hidden, now, bearing]);
};

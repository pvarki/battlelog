import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";
import type { Position } from "../cot.ts";
import { boundsOf } from "./follow.ts";
import { type ScreenPoint, uidsInOutline } from "./lasso.ts";

const CLICK_SLACK_PX = 4;
const INTERACTIVE_LAYERS = [
  "tak-points",
  "tak-shape-lines",
  "tak-shape-fills",
  "tak-tactical-labels",
  "tak-tactical-lines",
  "tak-tactical-fills",
];

type ScreenBox = [[number, number], [number, number]];

const uidsIn = (map: MapLibreMap, box: ScreenBox) => [
  ...new Set(
    map
      .queryRenderedFeatures(box, { layers: INTERACTIVE_LAYERS })
      .flatMap((f) => (f.properties?.uid ? [f.properties.uid as string] : [])),
  ),
];

// A few pixels of slack: thin lines are otherwise nearly impossible to hit.
export const slackBox = ({ x, y }: { x: number; y: number }): ScreenBox => [
  [x - CLICK_SLACK_PX, y - CLICK_SLACK_PX],
  [x + CLICK_SLACK_PX, y + CLICK_SLACK_PX],
];
export const uidsAt = (map: MapLibreMap, point: { x: number; y: number }) =>
  uidsIn(map, slackBox(point));

/** Draws a box from `start` while the pointer drags, then hands over the items inside it. */
export const dragSelectBox = (
  map: MapLibreMap,
  start: { x: number; y: number },
  onSelect: (uids: string[]) => void,
) => {
  const container = map.getContainer();
  const outline = document.createElement("div");
  outline.className = "tak-select-box";
  container.appendChild(outline);
  let box: ScreenBox = [
    [start.x, start.y],
    [start.x, start.y],
  ];
  const onMove = (e: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    const [x, y] = [e.clientX - rect.left, e.clientY - rect.top];
    box = [
      [Math.min(start.x, x), Math.min(start.y, y)],
      [Math.max(start.x, x), Math.max(start.y, y)],
    ];
    Object.assign(outline.style, {
      left: `${box[0][0]}px`,
      top: `${box[0][1]}px`,
      width: `${box[1][0] - box[0][0]}px`,
      height: `${box[1][1] - box[0][1]}px`,
    });
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    outline.remove();
    const [[left, top], [right, bottom]] = box;
    if (right - left > CLICK_SLACK_PX || bottom - top > CLICK_SLACK_PX) onSelect(uidsIn(map, box));
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};

const LASSO_STEP_PX = 3;

/** Lasso mode: pointer drags draw an outline instead of panning; returns the cleanup. */
export const followLasso = (map: MapLibreMap, onSelect: (uids: string[]) => void) => {
  const container = map.getCanvasContainer();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("tak-lasso");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  svg.appendChild(line);
  map.getContainer().appendChild(svg);
  map.dragPan.disable();
  container.style.cursor = "crosshair";
  let outline: ScreenPoint[] | undefined;

  const pointOf = (e: PointerEvent): ScreenPoint => {
    const rect = container.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const draw = () => line.setAttribute("points", (outline ?? []).map((p) => p.join(",")).join(" "));
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    outline = [pointOf(e)];
    draw();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };
  const onMove = (e: PointerEvent) => {
    if (!outline) return;
    const [x, y] = pointOf(e);
    const [lx, ly] = outline.at(-1) as ScreenPoint;
    if (Math.hypot(x - lx, y - ly) < LASSO_STEP_PX) return;
    outline.push([x, y]);
    draw();
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    const drawn = outline;
    outline = undefined;
    draw();
    if (!drawn || drawn.length < 3) return;
    const features = map.queryRenderedFeatures(boundsOf(drawn) as [Position, Position], {
      layers: INTERACTIVE_LAYERS,
    });
    onSelect(uidsInOutline(map, features, drawn));
  };
  container.addEventListener("pointerdown", onDown);
  return () => {
    container.removeEventListener("pointerdown", onDown);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    svg.remove();
    container.style.cursor = "";
    map.dragPan.enable();
  };
};

/** Rings the selected items on the picture's selection layers. */
export const useItemSelection = (map: MapLibreMap | undefined, selectedUids: readonly string[]) => {
  // A new array each render; the filter changes only when its members do.
  const selectedKey = JSON.stringify(selectedUids);
  useEffect(() => {
    if (!map) return;
    const uids: string[] = JSON.parse(selectedKey);
    const filter = ["in", ["get", "uid"], ["literal", uids]] as FilterSpecification;
    map.setFilter("tak-selected-point", filter);
    map.setFilter("tak-selected-shape", filter);
    map.setFilter("tak-selected-tactical", filter);
  }, [map, selectedKey]);
};

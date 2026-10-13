import type { Map as MapLibreMap } from "maplibre-gl";
import ms from "milsymbol";
import type { TakItem } from "../cot.ts";
import { categoryOf, sidcOf, teamColor } from "../items.ts";

/**
 * Map images (icons and label boxes) are drawn once per look on a canvas and
 * registered with MapLibre. Labels are images too, not map text, so the map
 * needs no font server and keeps working offline.
 */

export type MapImage = { id: string; width: number; height: number; offset: [number, number] };

export type LabelStyle = "marker" | "emphasis";

const LABEL_FONT: Record<LabelStyle, string> = {
  marker: "500 13px 'Inter Variable', Inter, system-ui, sans-serif",
  emphasis: "600 15px 'Inter Variable', Inter, system-ui, sans-serif",
};
// ATAK puts labels on a translucent black box instead of a halo.
const LABEL_BOX: Record<LabelStyle, string> = {
  marker: "rgba(0,0,0,0.6)",
  emphasis: "rgba(0,0,0,0.8)",
};
const LABEL_PAD_X = 4;
const LABEL_PAD_Y = 2;
const DOT_RADIUS = 7;

// ponytail: images are never evicted; fine for thousands of distinct looks, add LRU if drones churn callsigns.
const registered = new Map<string, MapImage>();

const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

type Art = {
  width: number;
  height: number;
  /** Where the map point lands on the image. */
  ax: number;
  ay: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
};

const register = (map: MapLibreMap, key: string, draw: () => Art): MapImage => {
  const existing = registered.get(key);
  if (existing && map.hasImage(existing.id)) return existing;
  const art = draw();
  const ratio = pixelRatio();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(art.width * ratio);
  canvas.height = Math.ceil(art.height * ratio);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.scale(ratio, ratio);
  art.paint(ctx);
  const id = existing?.id ?? `tak-img-${registered.size}`;
  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
  // MapLibre centres an image on its point; this shift puts the anchor there instead.
  const image: MapImage = {
    id,
    width: art.width,
    height: art.height,
    offset: [art.width / 2 - art.ax, art.height / 2 - art.ay],
  };
  registered.set(key, image);
  return image;
};

const milsymbolArt = (sidc: string): Art => {
  let symbol = new ms.Symbol(sidc, { size: 22 });
  if (!symbol.isValid()) symbol = new ms.Symbol("SUGP-----------", { size: 22 });
  const { width, height } = symbol.getSize();
  const { x, y } = symbol.getAnchor();
  const canvas = symbol.asCanvas(pixelRatio());
  return {
    width,
    height,
    ax: x,
    ay: y,
    paint: (ctx) => ctx.drawImage(canvas, 0, 0, width, height),
  };
};

const dotArt = (color: string, radius = DOT_RADIUS): Art => {
  const size = radius * 2 + 4;
  return {
    width: size,
    height: size,
    ax: size / 2,
    ay: size / 2,
    paint: (ctx) => {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#111418";
      ctx.stroke();
    },
  };
};

/** The icon for an item's point, drawn on first use. */
export const iconFor = (map: MapLibreMap, item: TakItem): MapImage => {
  if (categoryOf(item) === "users") {
    const color = teamColor(item.team);
    return register(map, `user|${color}`, () => dotArt(color));
  }
  const sidc = sidcOf(item);
  if (sidc) return register(map, `sidc|${sidc}`, () => milsymbolArt(sidc));
  const color = item.stroke?.color ?? "#fbb360";
  return register(map, `dot|${color}`, () => dotArt(color));
};

/** ATAK's small reference dot: shape centres and route waypoints, tinted with the line colour. */
export const referenceDot = (map: MapLibreMap, color: string): MapImage =>
  register(map, `ref|${color}`, () => dotArt(color, 4));

/** Arrowhead pointing up (north), for the far end of range-and-bearing lines. */
export const arrowhead = (map: MapLibreMap, color: string): MapImage =>
  register(map, `arrow|${color}`, () => ({
    width: 18,
    height: 18,
    ax: 9,
    ay: 2,
    paint: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(9, 1);
      ctx.lineTo(17, 17);
      ctx.lineTo(9, 13);
      ctx.lineTo(1, 17);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
    },
  }));

/** White text on ATAK's translucent black box, anchored at its centre. */
export const labelImage = (
  map: MapLibreMap,
  text: string,
  style: LabelStyle = "marker",
): MapImage =>
  register(map, `label|${style}|${text}`, () => {
    const measure = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    measure.font = LABEL_FONT[style];
    const size = Number.parseInt(LABEL_FONT[style].split(" ")[1] ?? "13", 10);
    const width = Math.ceil(measure.measureText(text).width) + LABEL_PAD_X * 2;
    const height = size + LABEL_PAD_Y * 2 + 2;
    return {
      width,
      height,
      ax: width / 2,
      ay: height / 2,
      paint: (ctx) => {
        ctx.fillStyle = LABEL_BOX[style];
        ctx.fillRect(0, 0, width, height);
        ctx.font = LABEL_FONT[style];
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, LABEL_PAD_X, height / 2 + 1);
      },
    };
  });

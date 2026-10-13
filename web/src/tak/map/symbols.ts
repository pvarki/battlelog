import type { Map as MapLibreMap } from "maplibre-gl";
import ms from "milsymbol";
import type { TakItem } from "../cot.ts";
import { labelOf, sidcOf, teamColor } from "../items.ts";

/**
 * Map icons are drawn once per look (symbol + label + colour) and registered
 * with MapLibre as images. Labels are drawn into the icon rather than as map
 * text, so the map needs no font server and keeps working offline.
 */

const LABEL_FONT = "600 12px 'Inter Variable', Inter, system-ui, sans-serif";
const LABEL_GAP = 4;
const DOT_RADIUS = 7;

type Icon = { id: string; offset: [number, number] };

// ponytail: images are never evicted; fine for hundreds of distinct looks, add LRU if drones churn callsigns.
const registered = new Map<string, Icon>();

const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

const drawLabel = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number) => {
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y);
};

const measure = (text: string) => {
  const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  ctx.font = LABEL_FONT;
  return Math.ceil(ctx.measureText(text).width) + 4;
};

/** A canvas holding `art` (width × height, anchor at ax, ay) with `label` to its right. */
const compose = (
  label: string,
  art: { width: number; height: number; ax: number; ay: number },
  paint: (ctx: CanvasRenderingContext2D) => void,
) => {
  const ratio = pixelRatio();
  const labelWidth = label ? measure(label) + LABEL_GAP : 0;
  const width = Math.ceil(art.width + labelWidth);
  const height = Math.ceil(Math.max(art.height, 16));
  const top = (height - art.height) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.scale(ratio, ratio);
  ctx.save();
  ctx.translate(0, top);
  paint(ctx);
  ctx.restore();
  if (label) drawLabel(ctx, label, art.width + LABEL_GAP, top + art.ay);
  // MapLibre centres the image on the point; shift so the anchor lands there.
  const offset: [number, number] = [width / 2 - art.ax, height / 2 - (top + art.ay)];
  return { canvas, offset, ratio };
};

const milsymbolArt = (sidc: string) => {
  let symbol = new ms.Symbol(sidc, { size: 22 });
  if (!symbol.isValid()) symbol = new ms.Symbol("SUGP-----------", { size: 22 });
  const { width, height } = symbol.getSize();
  const { x, y } = symbol.getAnchor();
  const art = symbol.asCanvas(pixelRatio());
  return {
    art: { width, height, ax: x, ay: y },
    paint: (ctx: CanvasRenderingContext2D) => ctx.drawImage(art, 0, 0, width, height),
  };
};

const dotArt = (color: string) => {
  const size = DOT_RADIUS * 2 + 4;
  return {
    art: { width: size, height: size, ax: size / 2, ay: size / 2 },
    paint: (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#111418";
      ctx.stroke();
    },
  };
};

const lookOf = (item: TakItem, label: string) => {
  if (item.team)
    return { key: `user|${item.team}|${label}`, art: () => dotArt(teamColor(item.team)) };
  const sidc = sidcOf(item);
  if (sidc) return { key: `sidc|${sidc}|${label}`, art: () => milsymbolArt(sidc) };
  const color = item.stroke?.color ?? "#fbb360";
  return { key: `dot|${color}|${label}`, art: () => dotArt(color) };
};

const register = (map: MapLibreMap, item: TakItem, label: string): Icon => {
  const { key, art } = lookOf(item, label);
  const existing = registered.get(key);
  if (existing && map.hasImage(existing.id)) return existing;
  const { art: box, paint } = art();
  const { canvas, offset, ratio } = compose(label, box, paint);
  const id = existing?.id ?? `tak-icon-${registered.size}`;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
  const icon = { id, offset };
  registered.set(key, icon);
  return icon;
};

/**
 * An item's icons with and without its name, drawn on first use. TAK users
 * always carry their callsign, as in ATAK; other names would bury the map at
 * low zoom, so the map swaps them in only when zoomed in.
 */
export const iconsFor = (map: MapLibreMap, item: TakItem): { labelled: Icon; bare: Icon } => {
  const labelled = register(map, item, labelOf(item));
  const bare = item.team ? labelled : register(map, item, "");
  return { labelled, bare };
};

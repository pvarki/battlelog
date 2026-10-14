import type { Map as MapLibreMap } from "maplibre-gl";
import ms from "milsymbol";
import type { TakItem } from "../cot.ts";
import { sidcOf, teamColor } from "../items.ts";
import { type IconsetImage, iconsetImage } from "./iconsets.ts";

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

// ponytail: icons are never evicted; fine for thousands of distinct looks. Labels are pruned (see pruneLabels).
const registered = new Map<string, MapImage>();
// Measurement labels change text as their items move, so unused ones must go.
const usedLabels = new Set<string>();
// Labels the drawing preview shows; the picture's redraws must not prune them from under it.
let previewLabels = new Set<string>();
/** While set, collects the labels drawn, so a cached item can mark them used without redrawing. */
let recording: string[] | undefined;

/** Runs `draw` and returns what it drew with the label keys it used. */
export const recordLabels = <T>(draw: () => T): [T, string[]] => {
  recording = [];
  try {
    return [draw(), recording];
  } finally {
    recording = undefined;
  }
};

/** Marks labels as still shown; false when one has been pruned from the map and must be drawn again. */
export const markLabelsUsed = (map: MapLibreMap, keys: readonly string[]): boolean => {
  for (const key of keys) {
    const image = registered.get(key);
    if (!image || !map.hasImage(image.id)) return false;
  }
  for (const key of keys) usedLabels.add(key);
  return true;
};

/** Call after drawing the preview, which doesn't prune: keeps its labels alive. */
export const keepUsedLabels = () => {
  previewLabels = new Set(usedLabels);
};
// A counter, not the map size: pruned labels must not hand their id to a new image.
let nextId = 0;
const MAX_LABELS = 3000;

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
  const id = existing?.id ?? `tak-img-${nextId++}`;
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

// ATAK tints stale markers grey: team members flat grey, everything else darkened.
const STALE_TEAM_COLOR = "#808080";
const STALE_FILTER = "grayscale(1) brightness(0.55)";

const milsymbolArt = (sidc: string, stale: boolean): Art => {
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
    paint: (ctx) => {
      if (stale) ctx.filter = STALE_FILTER;
      ctx.drawImage(canvas, 0, 0, width, height);
    },
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

/**
 * A team member's marker in their team colour, shaped by role the way ATAK
 * distinguishes them (our own drawings, not ATAK's icons).
 */
const roleArt = (color: string, role: string | undefined): Art => {
  const size = 22;
  const c = size / 2;
  const r = 8;
  return {
    width: size,
    height: size,
    ax: c,
    ay: c,
    paint: (ctx) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = "#111418";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (role === "HQ") ctx.rect(c - r, c - r, r * 2, r * 2);
      else if (role === "Forward Observer") {
        ctx.moveTo(c, c - r - 1);
        ctx.lineTo(c + r + 1, c + r);
        ctx.lineTo(c - r - 1, c + r);
        ctx.closePath();
      } else ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#111418";
      ctx.fillStyle = "#111418";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (role === "Team Lead") ctx.arc(c, c, 3, 0, Math.PI * 2);
      if (role === "Medic") {
        ctx.moveTo(c, c - 5);
        ctx.lineTo(c, c + 5);
        ctx.moveTo(c - 5, c);
        ctx.lineTo(c + 5, c);
      }
      if (role === "Sniper") {
        ctx.moveTo(c, c - r);
        ctx.lineTo(c, c + r);
        ctx.moveTo(c - r, c);
        ctx.lineTo(c + r, c);
      }
      ctx.stroke();
      if (role === "Team Lead") ctx.fill();
      const letter = role === "RTO" ? "R" : role === "K9" ? "K9" : undefined;
      if (letter) {
        ctx.font = "700 9px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, c, c + 0.5);
      }
    },
  };
};

// ATAK normalises icon-set icons to this square unless the set says skipResize.
const ICONSET_ICON_SIZE = 32;
const WHITE = "#ffffff";

/** ATAK multiplies an icon-set icon by the marker's colour; white leaves it as drawn. */
const iconsetArt = ({ bitmap, natural }: IconsetImage, color: string, stale: boolean): Art => {
  const width = natural ? bitmap.width : ICONSET_ICON_SIZE;
  const height = natural ? bitmap.height : ICONSET_ICON_SIZE;
  return {
    width,
    height,
    ax: width / 2,
    ay: height / 2,
    paint: (ctx) => {
      if (stale) ctx.filter = STALE_FILTER;
      ctx.drawImage(bitmap, 0, 0, width, height);
      ctx.filter = "none";
      if (color === WHITE) return;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(bitmap, 0, 0, width, height);
    },
  };
};

// ponytail: SPOTMAP "…/LABEL" (text only, no icon) draws a dot; handle it if senders use it.
const SPOT_MAP = "COT_MAPPING_SPOTMAP";

/**
 * The icon for an item's point, drawn on first use. ATAK `usericon` paths
 * draw from an imported icon set; until one is (or if none has the icon),
 * they fall back like ATAK without the set to the 2525 symbol for the type.
 */
export const iconFor = (map: MapLibreMap, item: TakItem, stale: boolean): MapImage => {
  if (item.team) {
    const color = stale ? STALE_TEAM_COLOR : teamColor(item.team);
    return register(map, `user|${color}|${item.role}`, () => roleArt(color, item.role));
  }
  const iconset = item.iconPath ? iconsetImage(item.iconPath) : undefined;
  if (iconset) {
    const color = item.stroke?.color ?? WHITE;
    return register(map, `iconset|${iconset.key}|${color}|${stale}`, () =>
      iconsetArt(iconset, color, stale),
    );
  }
  const sidc = item.iconPath?.startsWith(SPOT_MAP) ? undefined : sidcOf(item);
  if (sidc) return register(map, `sidc|${sidc}|${stale}`, () => milsymbolArt(sidc, stale));
  const color = stale ? STALE_TEAM_COLOR : (item.stroke?.color ?? "#fbb360");
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
): MapImage => {
  const key = `label|${style}|${text}`;
  usedLabels.add(key);
  recording?.push(key);
  return register(map, key, () => labelArt(text, style));
};

/** A label kept for good: the TAK picture's redraws prune only their own. */
export const keptLabelImage = (map: MapLibreMap, text: string): MapImage =>
  register(map, `kept-label|${text}`, () => labelArt(text, "marker"));

const labelArt = (text: string, style: LabelStyle): Art => {
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
};

/** Call after each redraw: removes label images no longer on the map once there are many. */
export const pruneLabels = (map: MapLibreMap) => {
  const labels = [...registered.keys()].filter((key) => key.startsWith("label|"));
  if (labels.length > MAX_LABELS) {
    for (const key of labels) {
      if (usedLabels.has(key) || previewLabels.has(key)) continue;
      const image = registered.get(key);
      if (image && map.hasImage(image.id)) map.removeImage(image.id);
      registered.delete(key);
    }
  }
  usedLabels.clear();
};

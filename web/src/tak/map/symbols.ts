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

// ponytail: SPOTMAP "…/LABEL" (text only, no icon) draws a dot; handle it if senders use it.
const SPOT_MAP = "COT_MAPPING_SPOTMAP";

/**
 * The icon for an item's point, drawn on first use. Icon-set images (ATAK
 * `usericon` paths) aren't available to a browser, so like ATAK without the
 * icon set those fall back to the 2525 symbol for the item's type.
 */
export const iconFor = (map: MapLibreMap, item: TakItem, stale: boolean): MapImage => {
  if (categoryOf(item) === "users") {
    const color = stale ? STALE_TEAM_COLOR : teamColor(item.team);
    return register(map, `user|${color}|${item.role}`, () => roleArt(color, item.role));
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

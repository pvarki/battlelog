import type { Map as MapLibreMap } from "maplibre-gl";
import ms from "milsymbol";
import type { TakItem } from "../cot.ts";
import { sidcOf, teamColor } from "../items.ts";
import { type IconsetImage, iconsetImage } from "./iconsets.ts";
import { oldestUnused, remember, touch } from "./lru.ts";

/**
 * Map images (icons and label boxes) are drawn on a canvas and registered with
 * MapLibre. Labels are images too, not map text, so the map needs no font
 * server and keeps working offline.
 *
 * An image's id says how to draw it, so features name their images without
 * drawing them and the map draws only those it lays out (see serveMapImages):
 * of thousands of items, most are off screen or zoomed past their label.
 */

export type MapImage = { id: string; width: number; height: number; offset: [number, number] };

export type LabelStyle = "marker" | "emphasis" | "graphic";

const LABEL_FONT: Record<LabelStyle, string> = {
  marker: "500 13px 'Inter Variable', Inter, system-ui, sans-serif",
  emphasis: "600 15px 'Inter Variable', Inter, system-ui, sans-serif",
  graphic: "600 12px 'Inter Variable', Inter, system-ui, sans-serif",
};
// ATAK puts labels on a translucent black box instead of a halo.
const LABEL_BOX: Record<LabelStyle, string> = {
  marker: "rgba(0,0,0,0.6)",
  emphasis: "rgba(0,0,0,0.8)",
  graphic: "rgba(0,0,0,0.6)",
};
const LABEL_PAD_X = 4;
const LABEL_PAD_Y = 2;
const DOT_RADIUS = 7;

const MAX_LABELS = 1500;
const MAX_ICONS = 2000;

const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

type Art = {
  width: number;
  height: number;
  /** Where the map point lands on the image. */
  ax: number;
  ay: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
};

type Kind = "label" | "user" | "iconset" | "sidc" | "dot" | "arrow";

const ID_PREFIX = "tak-img:";

/** An image's id: what it is and everything its look depends on. */
export const imageId = (kind: Kind, ...args: string[]) =>
  `${ID_PREFIX}${JSON.stringify([kind, ...args])}`;

/** What `imageId` was given, or undefined for an image not ours. */
export const imageArgs = (id: string): [Kind, ...string[]] | undefined =>
  id.startsWith(ID_PREFIX) ? JSON.parse(id.slice(ID_PREFIX.length)) : undefined;

const artOf = (id: string): Art | undefined => {
  const args = imageArgs(id);
  if (!args) return undefined;
  const [kind, ...rest] = args;
  return ART[kind](...rest);
};

const imageData = (art: Art, ratio: number): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(art.width * ratio);
  canvas.height = Math.ceil(art.height * ratio);
  // CPU-backed: reading a GPU canvas back for every label stalls the page on a busy picture.
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.scale(ratio, ratio);
  art.paint(ctx);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

/**
 * The images the map's loaded tiles may lay out. Removing one makes MapLibre
 * reload those tiles, so a view needing more images than the cap would evict
 * and redraw its own forever. A feature counts unless its `minZoom` (or its
 * layer's) is above the view, where no tile asks for its image.
 */
const imagesInUse = (map: MapLibreMap): Set<string> => {
  // A zoom of slack for the finer tiles kept on screen while zooming out.
  const zoom = map.getZoom() + 1;
  const sources = new Set<string>();
  for (const id of map.getLayersOrder()) {
    const layer = map.getLayer(id);
    if (layer?.type === "symbol" && (layer.minzoom ?? 0) <= zoom) sources.add(layer.source);
  }
  const used = new Set<string>();
  for (const source of sources) {
    for (const { properties } of map.querySourceFeatures(source)) {
      if (typeof properties.icon === "string" && !(properties.minZoom > zoom))
        used.add(properties.icon);
    }
  }
  return used;
};

/**
 * Draws an image when the map first lays out a symbol that names it, and once
 * over the caps removes those drawn longest ago that no loaded tile uses; one
 * that comes back into view is drawn again.
 */
export const serveMapImages = (map: MapLibreMap) => {
  // Per map, so one map's eviction never removes another's images.
  const labels = new Set<string>();
  const icons = new Set<string>();
  let evicting = false;
  const evict = () => {
    evicting = false;
    const inUse = imagesInUse(map);
    for (const [drawn, max] of [
      [labels, MAX_LABELS],
      [icons, MAX_ICONS],
    ] as const) {
      for (const id of oldestUnused(drawn, drawn.size - max, inUse)) {
        drawn.delete(id);
        if (map.hasImage(id)) map.removeImage(id);
      }
    }
  };
  // Synchronous on purpose: MapLibre hands the tile asking for it whatever the resolver added.
  map.setMissingStyleImageResolver((id) => {
    const art = artOf(id);
    if (!art || map.hasImage(id)) return;
    const ratio = pixelRatio();
    map.addImage(id, imageData(art, ratio), { pixelRatio: ratio });
    const drawn = imageArgs(id)?.[0] === "label" ? labels : icons;
    drawn.delete(id);
    drawn.add(id);
    if (!evicting && (labels.size > MAX_LABELS || icons.size > MAX_ICONS)) {
      evicting = true;
      map.once("idle", evict);
    }
  });
};

// An icon's size by id, so a redraw needn't build its symbol again.
const sizes = new Map<string, MapImage>();

const sized = (id: string): MapImage => {
  const known = touch(sizes, id);
  if (known) return known;
  const art = artOf(id);
  if (!art) return { id, width: 0, height: 0, offset: [0, 0] };
  // MapLibre centres an image on its point; this shift puts the anchor there instead.
  const image: MapImage = {
    id,
    width: art.width,
    height: art.height,
    offset: [art.width / 2 - art.ax, art.height / 2 - art.ay],
  };
  remember(sizes, id, image, MAX_ICONS);
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
  return {
    width,
    height,
    ax: x,
    ay: y,
    paint: (ctx) => {
      if (stale) ctx.filter = STALE_FILTER;
      ctx.drawImage(symbol.asCanvas(pixelRatio()), 0, 0, width, height);
    },
  };
};

const dotArt = (color: string, radius: number): Art => {
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

// The roles ATAK marks; any other role draws as a plain team marker.
const MARKED_ROLES = new Set([
  "HQ",
  "Forward Observer",
  "Team Lead",
  "Medic",
  "Sniper",
  "RTO",
  "K9",
]);

/**
 * A team member's marker in their team colour, shaped by role the way ATAK
 * distinguishes them (our own drawings, not ATAK's icons).
 */
const roleArt = (color: string, role: string): Art => {
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

const arrowArt = (color: string): Art => ({
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
});

const labelHeight = (style: LabelStyle) =>
  Number.parseInt(LABEL_FONT[style].split(" ")[1] ?? "13", 10) + LABEL_PAD_Y * 2 + 2;

const labelArt = (text: string, style: LabelStyle): Art => {
  const measure = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  measure.font = LABEL_FONT[style];
  const width = Math.ceil(measure.measureText(text).width) + LABEL_PAD_X * 2;
  const height = labelHeight(style);
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

const ART: Record<Kind, (...args: string[]) => Art | undefined> = {
  label: (style, text) => labelArt(text ?? "", style as LabelStyle),
  user: (color, role) => roleArt(color ?? WHITE, role ?? ""),
  iconset: (path, key, color, stale) => {
    const image = iconsetImage(path ?? "");
    // Its set was re-imported or removed since: the next redraw names the new image.
    return image?.key === key ? iconsetArt(image, color ?? WHITE, stale === "true") : undefined;
  },
  sidc: (sidc, stale) => milsymbolArt(sidc ?? "", stale === "true"),
  dot: (color, radius) => dotArt(color ?? WHITE, Number(radius)),
  arrow: (color) => arrowArt(color ?? WHITE),
};

// ponytail: SPOTMAP "…/LABEL" (text only, no icon) draws a dot; handle it if senders use it.
const SPOT_MAP = "COT_MAPPING_SPOTMAP";

/**
 * The icon for an item's point. ATAK `usericon` paths draw from an imported
 * icon set or TAK Server's; until one is (or if none has the icon), they fall
 * back like ATAK without the set to the 2525 symbol for the type.
 */
export const iconFor = (item: TakItem, stale: boolean): MapImage => {
  if (item.team) {
    const color = stale ? STALE_TEAM_COLOR : teamColor(item.team);
    const role = item.role && MARKED_ROLES.has(item.role) ? item.role : "";
    return sized(imageId("user", color, role));
  }
  const iconset = item.iconPath ? iconsetImage(item.iconPath) : undefined;
  if (iconset && item.iconPath) {
    const color = item.stroke?.color ?? WHITE;
    return sized(imageId("iconset", item.iconPath, iconset.key, color, String(stale)));
  }
  const sidc = item.iconPath?.startsWith(SPOT_MAP) ? undefined : sidcOf(item);
  if (sidc) return sized(imageId("sidc", sidc, String(stale)));
  const color = stale ? STALE_TEAM_COLOR : (item.stroke?.color ?? "#fbb360");
  return sized(imageId("dot", color, String(DOT_RADIUS)));
};

/** ATAK's small reference dot: shape centres and route waypoints, tinted with the line colour. */
export const referenceDot = (color: string): MapImage => sized(imageId("dot", color, "4"));

/** Arrowhead pointing up (north), for the far end of range-and-bearing lines. */
export const arrowhead = (color: string): MapImage => sized(imageId("arrow", color));

/** White text on ATAK's translucent black box, anchored at its centre; drawn once on screen. */
export const labelImage = (
  text: string,
  style: LabelStyle = "marker",
): { id: string; height: number } => ({
  id: imageId("label", style, text),
  height: labelHeight(style),
});

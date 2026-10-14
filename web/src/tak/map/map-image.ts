import type { Map as MapLibreMap } from "maplibre-gl";
import { type CoordFormat, formatCoord } from "../coords.ts";

/**
 * The map as an image to print or hand on: what's on screen, with a header
 * saying when and where it was taken and a footer crediting the map data.
 * Hover names and other floating DOM aren't part of it.
 */

const BAND_PX = 36;
const FONT = "600 15px Inter, system-ui, sans-serif";

/** The rendered frame, read during the render that produced it: WebGL clears it afterwards. */
const frameOf = (map: MapLibreMap): Promise<HTMLCanvasElement> =>
  new Promise((resolve) => {
    map.once("render", () => resolve(map.getCanvas()));
    map.triggerRepaint();
  });

const attributionOf = (map: MapLibreMap) =>
  [
    ...new Set(
      Object.values(map.getStyle().sources).flatMap((s) =>
        "attribution" in s && s.attribution ? [s.attribution] : [],
      ),
    ),
  ].join(" · ");

export const mapImage = async (
  map: MapLibreMap,
  coordFormat: CoordFormat,
  now = new Date(),
): Promise<HTMLCanvasElement> => {
  const frame = await frameOf(map);
  const ratio = frame.width / frame.clientWidth || 1;
  const band = Math.round(BAND_PX * ratio);
  const out = document.createElement("canvas");
  out.width = frame.width;
  out.height = frame.height + 2 * band;
  const ctx = out.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(frame, 0, band);
  ctx.fillStyle = "#111418";
  ctx.fillRect(0, 0, out.width, band);
  ctx.fillRect(0, band + frame.height, out.width, band);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.scale(ratio, ratio);
  ctx.font = FONT;
  const { lng, lat } = map.getCenter();
  const bearing = Math.round(map.getBearing());
  const header = [
    `BattleLog · ${now.toLocaleString("fi-FI")}`,
    `Centre ${formatCoord([lng, lat], coordFormat)}`,
    bearing ? `Map rotated ${bearing}°` : "North up",
  ].join("   ·   ");
  ctx.fillText(header, 12, BAND_PX / 2);
  ctx.fillText(attributionOf(map), 12, BAND_PX * 1.5 + frame.height / ratio);
  return out;
};

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No image"))), "image/png"),
  );

export const mapImageBlob = async (map: MapLibreMap, coordFormat: CoordFormat) =>
  toBlob(await mapImage(map, coordFormat));

/** Prints the image alone, landscape, through a hidden frame. */
export const printImage = async (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument as Document;
  doc.open();
  doc.write(
    `<!doctype html><title>BattleLog map</title><style>@page{size:landscape;margin:8mm}html,body{margin:0}img{width:100%;height:auto}</style><img src="${url}">`,
  );
  doc.close();
  await new Promise((resolve) => {
    const img = doc.querySelector("img") as HTMLImageElement;
    img.complete ? resolve(undefined) : img.addEventListener("load", resolve, { once: true });
  });
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  // The print dialog blocks in some browsers and not in others; tidy up after either.
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
};

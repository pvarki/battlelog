import type { RasterSourceSpecification } from "maplibre-gl";
import { z } from "zod";
import type { MapSource } from "./basemaps.ts";

/** A map source the viewer added by URL or from an ATAK map source file. */
export type CustomSource = {
  id: string;
  label: string;
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  scheme: "xyz" | "tms";
};

const customSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  tiles: z.array(z.string()).min(1),
  minzoom: z.number(),
  maxzoom: z.number(),
  scheme: z.enum(["xyz", "tms"]),
});

/** Stored sources come from this browser or an imported settings file: one that's malformed is skipped. */
export const isCustomSource = (value: unknown): value is CustomSource =>
  customSourceSchema.safeParse(value).success;

export class MapSourceError extends Error {}

const WEB_MERCATOR = new Set(["EPSG:3857", "EPSG:900913", "EPSG:102100"]);
const ZOOM_LIMIT = 24;

const zoom = (text: string | null | undefined, fallback: number) => {
  const value = Number.parseInt(text ?? "", 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), ZOOM_LIMIT) : fallback;
};

const PLACEHOLDERS: [RegExp, string][] = [
  [/\{\$?z\}/gi, "{z}"],
  [/\{\$?x\}/gi, "{x}"],
  [/\{\$?y\}/gi, "{y}"],
  [/\{\$q\}|\{q\}/gi, "{quadkey}"],
];

/**
 * MapLibre tile URLs from a template in ATAK's (`{$z}`, `{$q}`, `{$serverpart}`)
 * or the common XYZ style (`{z}`, `{-y}` for TMS, `{s}` for server parts).
 */
export const tileUrls = (
  template: string,
  serverParts: string[] = ["a", "b", "c"],
): Pick<CustomSource, "tiles" | "scheme"> => {
  let url = template.trim();
  if (!/^https?:\/\/[^/\s]+/i.test(url))
    throw new MapSourceError("Map sources must be http or https addresses.");
  const scheme = /\{-y\}/i.test(url) ? "tms" : "xyz";
  url = url.replace(/\{-y\}/gi, "{y}");
  for (const [pattern, replacement] of PLACEHOLDERS) url = url.replace(pattern, replacement);
  const xyz = ["{z}", "{x}", "{y}"].every((p) => url.includes(p));
  const tiled = xyz || url.includes("{quadkey}") || url.includes("{bbox-epsg-3857}");
  if (!tiled)
    throw new MapSourceError("The address needs {z}, {x} and {y} (or {q}) where the tile goes.");
  const part = /\{\$serverpart\}|\{s\}/i;
  const tiles = part.test(url) ? serverParts.map((s) => url.replace(part, s)) : [url];
  return { tiles, scheme };
};

/** A map source's settings by ATAK's XML tag names, which TAK Server's map layers share. */
export type SourceFields = (name: string) => string | undefined;

const wmsUrl = (text: SourceFields) => {
  const base = text("url");
  const layers = text("layers") ?? text("layer");
  if (!base || !layers) throw new MapSourceError("The WMS source has no url or layers.");
  const crs = text("coordinateSystem");
  if (crs && !WEB_MERCATOR.has(crs.toUpperCase()))
    throw new MapSourceError(`Only Web Mercator WMS sources work here, not ${crs}.`);
  const format = text("format") ?? `image/${text("tileType") ?? "png"}`;
  const query = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: text("version") ?? "1.1.1",
    REQUEST: "GetMap",
    LAYERS: layers,
    STYLES: text("styles") ?? "",
    SRS: "EPSG:3857",
    WIDTH: "256",
    HEIGHT: "256",
    FORMAT: format,
    TRANSPARENT: "true",
  });
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}${query}&BBOX={bbox-epsg-3857}`;
};

export const sourceFromFields = (text: SourceFields, wms: boolean, id: string): CustomSource => {
  const template = wms ? wmsUrl(text) : text("url");
  if (!template) throw new MapSourceError("The map source has no url.");
  const serverParts = text("serverParts")?.split(/\s+/);
  const { tiles, scheme } = tileUrls(template, serverParts);
  const inverted = text("invertYCoordinate")?.toLowerCase() === "true";
  return {
    id,
    label: text("name") ?? "Imported map",
    tiles,
    minzoom: zoom(text("minZoom"), 0),
    maxzoom: zoom(text("maxZoom"), 19),
    scheme: inverted ? "tms" : scheme,
  };
};

/** ATAK's `<customMapSource>` / `<customWmsMapSource>` XML, as dropped into its imagery folder. */
export const parseAtakMapSource = (xml: string, id: string): CustomSource => {
  const root = new DOMParser().parseFromString(xml, "application/xml").documentElement;
  const kind = root?.nodeName;
  if (kind !== "customMapSource" && kind !== "customWmsMapSource")
    throw new MapSourceError("Not an ATAK map source file.");
  const text = (tag: string) => root.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;
  return sourceFromFields(text, kind === "customWmsMapSource", id);
};

export const toMapSource = (
  source: CustomSource,
  origin: MapSource["origin"] = "custom",
): MapSource => {
  const spec: RasterSourceSpecification = {
    type: "raster",
    tiles: source.tiles,
    tileSize: 256,
    minzoom: source.minzoom,
    maxzoom: source.maxzoom,
    scheme: source.scheme,
  };
  return { id: source.id, label: source.label, spec, origin };
};

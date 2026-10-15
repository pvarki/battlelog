import type { Bounds } from "../geo.ts";
import type { MapSource } from "./basemaps.ts";

/**
 * Downloading a map area ahead of time: every tile of the visible area for a
 * few zoom levels is fetched once, and the service worker's tile cache keeps
 * it for offline use (ATAK's "download map area").
 */

export type Tile = { z: number; x: number; y: number };

/** More than this is a job for an offline map file, not the browser cache. */
export const MAX_AREA_TILES = 3000;
const PARALLEL = 6;
const TILE_ACCEPT = "image/webp,*/*";
const HALF_WORLD_M = 20_037_508.342789244;

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const rad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

export const tilesIn = ({ west, south, east, north }: Bounds, z: number): Tile[] => {
  const last = 2 ** z - 1;
  const clamp = (n: number) => Math.max(0, Math.min(last, n));
  const tiles: Tile[] = [];
  for (let x = clamp(tileX(west, z)); x <= clamp(tileX(east, z)); x++) {
    for (let y = clamp(tileY(north, z)); y <= clamp(tileY(south, z)); y++) tiles.push({ z, x, y });
  }
  return tiles;
};

/** The zoom levels from `fromZoom` up whose tiles together stay under `MAX_AREA_TILES`. */
export const areaPlan = (bounds: Bounds, fromZoom: number, maxZoom: number) => {
  const tiles: Tile[] = [];
  let toZoom = fromZoom - 1;
  for (let z = fromZoom; z <= maxZoom; z++) {
    const level = tilesIn(bounds, z);
    if (tiles.length + level.length > MAX_AREA_TILES) break;
    tiles.push(...level);
    toZoom = z;
  }
  return { tiles, fromZoom, toZoom };
};

const quadkey = ({ z, x, y }: Tile) => {
  let key = "";
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    key += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
  }
  return key;
};

const bbox3857 = ({ z, x, y }: Tile) => {
  const size = (2 * HALF_WORLD_M) / 2 ** z;
  const minX = -HALF_WORLD_M + x * size;
  const maxY = HALF_WORLD_M - y * size;
  return [minX, maxY - size, minX + size, maxY].join(",");
};

/** The URL MapLibre would request for `tile` from this template. */
export const tileUrl = (template: string, tile: Tile, scheme: "xyz" | "tms" = "xyz") => {
  const y = scheme === "tms" ? 2 ** tile.z - 1 - tile.y : tile.y;
  return template
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(y))
    .replace("{quadkey}", quadkey(tile))
    .replace("{bbox-epsg-3857}", bbox3857(tile));
};

/** Online maps can be saved; offline files already are. */
/** Only tiles the service worker's map-tiles cache takes (vite.config.ts): other sites', not TAK's. */
const isCachedTileUrl = (template: string) => {
  const url = new URL(template.replace(/\{[^}]+\}/g, "0"), location.href);
  return url.origin !== location.origin && !url.pathname.startsWith("/Marti/");
};

export const canSaveArea = (source: MapSource) =>
  !!source.spec.tiles?.length && source.spec.tiles.every(isCachedTileUrl);

/** Fetches every tile once; resolves with how many failed. */
export const saveArea = async (
  source: MapSource,
  tiles: Tile[],
  onProgress: (done: number) => void,
  signal: AbortSignal,
): Promise<number> => {
  const templates = source.spec.tiles ?? [];
  const scheme = source.spec.scheme ?? "xyz";
  let next = 0;
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (next < tiles.length && !signal.aborted) {
      const i = next++;
      const template = templates[i % templates.length] as string;
      try {
        // The same request MapLibre makes, so the service worker files it with the map's tiles.
        const res = await fetch(tileUrl(template, tiles[i] as Tile, scheme), {
          signal,
          headers: { accept: TILE_ACCEPT },
        });
        if (!res.ok) failed++;
      } catch {
        if (!signal.aborted) failed++;
      }
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return failed;
};

import { addProtocol } from "maplibre-gl";
import { FileSource, PMTiles, Protocol, TileType } from "pmtiles";
import { useSyncExternalStore } from "react";
import type { MapSource } from "./basemaps.ts";

/**
 * Offline maps: raster PMTiles files kept in the browser's private file
 * storage (OPFS), read a range at a time so multi-GB files never load whole.
 * Without OPFS (some private windows) a file lasts until the page closes.
 */

const DIR = "offline-maps";
const RASTER = new Set([TileType.Png, TileType.Jpeg, TileType.Webp, TileType.Avif]);

export class OfflineMapError extends Error {}

const protocol = new Protocol();
let protocolAdded = false;

let maps: MapSource[] = [];
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

const publish = (next: MapSource[]) => {
  maps = next.sort((a, b) => a.label.localeCompare(b.label));
  for (const listener of listeners) listener();
};

const directory = async (): Promise<FileSystemDirectoryHandle | undefined> => {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR, { create: true });
  } catch {
    return undefined;
  }
};

const register = async (file: File): Promise<MapSource> => {
  if (!protocolAdded) {
    addProtocol("pmtiles", protocol.tile);
    protocolAdded = true;
  }
  const archive = new PMTiles(new FileSource(file));
  let header: Awaited<ReturnType<PMTiles["getHeader"]>>;
  try {
    header = await archive.getHeader();
  } catch {
    throw new OfflineMapError(`${file.name} isn't a PMTiles file.`);
  }
  if (!RASTER.has(header.tileType))
    throw new OfflineMapError(
      `${file.name} holds vector tiles; only raster (image) maps can be shown.`,
    );
  protocol.add(archive);
  return {
    id: `offline:${file.name}`,
    label: file.name.replace(/\.pmtiles$/i, ""),
    spec: {
      type: "raster",
      url: `pmtiles://${file.name}`,
      // ponytail: assumes 256 px tiles; read tile size from the metadata if 512 px maps look small.
      tileSize: 256,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    },
    origin: "offline",
  };
};

const load = () => {
  loading ??= (async () => {
    const dir = await directory();
    if (!dir) return;
    const found: MapSource[] = [];
    for await (const handle of dir.values()) {
      if (handle.kind !== "file") continue;
      try {
        found.push(await register(await (handle as FileSystemFileHandle).getFile()));
      } catch {
        // a broken or half-written file: it stays listed in storage, not on the map
      }
    }
    publish(found);
  })();
  return loading;
};

export const useOfflineMaps = (): MapSource[] => {
  void load();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => maps,
  );
};

const store = async (file: File): Promise<File> => {
  const dir = await directory();
  if (!dir) return file;
  void navigator.storage.persist?.();
  const handle = await dir.getFileHandle(file.name, { create: true });
  try {
    await file.stream().pipeTo(await handle.createWritable());
  } catch (err) {
    await dir.removeEntry(file.name).catch(() => undefined);
    throw new OfflineMapError(
      err instanceof DOMException && err.name === "QuotaExceededError"
        ? "Not enough browser storage for this map."
        : `Couldn't store ${file.name}.`,
    );
  }
  return handle.getFile();
};

/** Adds a PMTiles map, or replaces the one with the same file name. */
export const addOfflineMap = async (file: File): Promise<MapSource> => {
  await register(file);
  await load();
  const source = await register(await store(file));
  publish([...maps.filter((m) => m.id !== source.id), source]);
  return source;
};

export const removeOfflineMap = async (source: MapSource) => {
  publish(maps.filter((m) => m.id !== source.id));
  const dir = await directory();
  await dir?.removeEntry(source.id.slice("offline:".length)).catch(() => undefined);
};

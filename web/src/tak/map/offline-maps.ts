import { addProtocol } from "maplibre-gl";
import {
  bytesToHeader,
  Compression,
  FileSource,
  PMTiles,
  Protocol,
  readVarint,
  TileType,
} from "pmtiles";
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

// pmtiles reads the header and root directory from the file's first 16 KiB.
const HEAD_BYTES = 16_384;
const MAX_DIRECTORY_BYTES = 16 * 1_048_576;
const MAX_ROOT_ENTRIES = 1_000_000;

/** pmtiles' own decompress inflates a directory to whatever size the file makes it. */
const decompress = async (data: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> => {
  if (compression === Compression.None || compression === Compression.Unknown) return data;
  if (compression !== Compression.Gzip) throw new Error("Compression method not supported");
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.length;
    if (size > MAX_DIRECTORY_BYTES) {
      await reader.cancel();
      throw new Error("Directory too large");
    }
    chunks.push(read.value);
  }
  return new Blob(chunks).arrayBuffer();
};

/** Whether the root directory is small enough to read; pmtiles materialises every entry. */
const rootFits = async (file: File) => {
  const head = await file.slice(0, HEAD_BYTES).arrayBuffer();
  const header = bytesToHeader(head);
  const { rootDirectoryOffset: offset, rootDirectoryLength: length } = header;
  const root = await decompress(head.slice(offset, offset + length), header.internalCompression);
  return readVarint({ buf: new Uint8Array(root), pos: 0 }) <= MAX_ROOT_ENTRIES;
};

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

const usableHeader = async (file: File, archive: PMTiles) => {
  try {
    return (await rootFits(file)) ? await archive.getHeader() : undefined;
  } catch {
    return undefined;
  }
};

const register = async (file: File): Promise<MapSource> => {
  if (!protocolAdded) {
    addProtocol("pmtiles", protocol.tile);
    protocolAdded = true;
  }
  const archive = new PMTiles(new FileSource(file), undefined, decompress);
  const header = await usableHeader(file, archive);
  if (!header) throw new OfflineMapError(`${file.name} isn't a usable PMTiles map file.`);
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

/** The stored copy of `file`, or undefined when this browser can't keep files. */
const store = async (file: File): Promise<File | undefined> => {
  const dir = await directory();
  if (!dir) return undefined;
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

/**
 * Adds a PMTiles map; `kept` is false when the browser can't store it, so it
 * lasts until reload. A stored map is never overwritten: a failed write would lose it.
 */
export const addOfflineMap = async (file: File): Promise<{ source: MapSource; kept: boolean }> => {
  await load();
  if (maps.some((m) => m.id === `offline:${file.name}`))
    throw new OfflineMapError(`A map named ${file.name} is already stored; remove it first.`);
  await register(file);
  const stored = await store(file);
  const source = await register(stored ?? file);
  publish([...maps.filter((m) => m.id !== source.id), source]);
  return { source, kept: !!stored };
};

export const removeOfflineMap = async (source: MapSource) => {
  publish(maps.filter((m) => m.id !== source.id));
  const dir = await directory();
  await dir?.removeEntry(source.id.slice("offline:".length)).catch(() => undefined);
};

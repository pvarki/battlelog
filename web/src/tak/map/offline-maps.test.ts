import { gzipSync } from "fflate";
import { expect, test, vi } from "vitest";

type TileHandler = (params: { url: string }, abort: AbortController) => Promise<unknown>;

const maplibre = vi.hoisted(() => ({ tile: undefined as TileHandler | undefined }));
vi.mock("maplibre-gl", () => ({
  addProtocol: (_: string, tile: TileHandler) => {
    maplibre.tile = tile;
  },
}));

const { addOfflineMap, OfflineMapError } = await import("./offline-maps.ts");

const HEADER_BYTES = 127;
const GZIP = 2;
const NONE = 1;

const varint = (value: number) => {
  const bytes = [];
  for (let n = value; ; n = Math.floor(n / 128)) {
    if (n < 128) {
      bytes.push(n);
      break;
    }
    bytes.push((n % 128) | 128);
  }
  return bytes;
};

/** A directory of `entries` one-tile entries. */
const directoryOf = (entries: number) => {
  const count = varint(entries);
  const directory = new Uint8Array(count.length + 4 * entries).fill(1);
  directory.set(count);
  return directory;
};

/** A raster PMTiles file: its root directory, then an optional leaf directory. */
const pmtiles = (
  name: string,
  root: Uint8Array,
  leaf: Uint8Array = new Uint8Array(),
  compression = GZIP,
) => {
  const bytes = new Uint8Array(HEADER_BYTES + root.length + leaf.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x50, 0x4d], 0);
  view.setUint8(7, 3);
  view.setUint32(8, HEADER_BYTES, true);
  view.setUint32(16, root.length, true);
  view.setUint32(40, HEADER_BYTES + root.length, true);
  view.setUint32(48, leaf.length, true);
  view.setUint8(97, compression);
  view.setUint8(98, 1);
  view.setUint8(99, 2);
  bytes.set(root, HEADER_BYTES);
  bytes.set(leaf, HEADER_BYTES + root.length);
  return new File([bytes], name);
};

test("a map whose root directory lists over a million entries is refused before it is read", async () => {
  const file = pmtiles("big-root.pmtiles", gzipSync(directoryOf(1_100_000)));
  await expect(addOfflineMap(file)).rejects.toThrow(OfflineMapError);
});

test("a small map is still added", async () => {
  const file = pmtiles("small.pmtiles", gzipSync(directoryOf(10)));
  await expect(addOfflineMap(file)).resolves.toMatchObject({ kept: false });
});

test.each([
  ["gzip", GZIP, gzipSync],
  ["uncompressed", NONE, (bytes: Uint8Array) => bytes],
])(
  "a leaf directory (%s) over a million entries is refused when a tile reads it",
  async (kind, compression, encode) => {
    const leaf = encode(directoryOf(1_100_000));
    // tile 0 points at the leaf: id delta 0, run length 0 (a leaf), its length, offset 0 stored as 1
    const root = new Uint8Array([1, 0, 0, ...varint(leaf.length), 1]);
    const name = `big-leaf-${kind}.pmtiles`;
    await addOfflineMap(pmtiles(name, encode(root), leaf, compression));
    await expect(
      maplibre.tile?.({ url: `pmtiles://${name}/0/0/0` }, new AbortController()),
    ).rejects.toThrow("Directory too large");
  },
);

import { gzipSync } from "fflate";
import { expect, test } from "vitest";
import { addOfflineMap, OfflineMapError } from "./offline-maps.ts";

const HEADER_BYTES = 127;

/** A raster PMTiles file whose root directory lists `entries` one-tile entries. */
const pmtilesWithRoot = (entries: number) => {
  const varint = [];
  for (let n = entries; ; n = Math.floor(n / 128)) {
    if (n < 128) {
      varint.push(n);
      break;
    }
    varint.push((n % 128) | 128);
  }
  const directory = new Uint8Array(varint.length + 4 * entries).fill(1);
  directory.set(varint);
  const root = gzipSync(directory);
  const bytes = new Uint8Array(HEADER_BYTES + root.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x50, 0x4d], 0);
  view.setUint8(7, 3);
  view.setUint32(8, HEADER_BYTES, true);
  view.setUint32(16, root.length, true);
  view.setUint8(97, 2);
  view.setUint8(98, 1);
  view.setUint8(99, 2);
  bytes.set(root, HEADER_BYTES);
  return new File([bytes], `root-${entries}.pmtiles`);
};

test("a map whose root directory lists over a million entries is refused before it is read", async () => {
  await expect(addOfflineMap(pmtilesWithRoot(1_100_000))).rejects.toThrow(OfflineMapError);
});

test("a small map is still added", async () => {
  await expect(addOfflineMap(pmtilesWithRoot(10))).resolves.toMatchObject({ kept: false });
});

// @vitest-environment happy-dom
import { strFromU8, strToU8, Zip, ZipDeflate, zipSync } from "fflate";
import { expect, test } from "vitest";
import { parseIconset } from "./map/iconsets.ts";
import { unzipLimited } from "./plans/plans.ts";
import { ZipLimitError } from "./zip.ts";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;

/** The zip with every entry claiming to inflate to `size` bytes. */
const declaring = (zip: Uint8Array, size: number) => {
  const forged = zip.slice();
  const view = new DataView(forged.buffer);
  for (let i = 0; i + 4 <= forged.length; i++) {
    const signature = view.getUint32(i, true);
    if (signature === LOCAL_HEADER) view.setUint32(i + 22, size, true);
    if (signature === CENTRAL_HEADER) view.setUint32(i + 24, size, true);
  }
  return forged;
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("an entry that inflates past the size it declares is refused, not cut short", () => {
  const zip = declaring(zipSync({ "a/a.cot": new Uint8Array(4 * 1_048_576) }), 1000);
  expect(() => unzipLimited(zip, () => true)).toThrow(ZipLimitError);
});

test("an entry smaller than it declares is refused", () => {
  const zip = declaring(zipSync({ "a/a.cot": strToU8("<event/>") }), 1000);
  expect(() => unzipLimited(zip, () => true)).toThrow(ZipLimitError);
});

test("entries are capped by what they really inflate to", () => {
  const zip = declaring(zipSync({ "a/a.cot": new Uint8Array(4 * 1_048_576) }), 0);
  expect(() => unzipLimited(zip, () => true)).toThrow(/too large/);
});

test("an icon set whose icon lies about its size is refused", () => {
  const big = new Uint8Array(2 * 1024 * 1024);
  big.set(PNG);
  const zip = zipSync({ "iconset.xml": strToU8('<iconset uid="x"/>'), "A/big.png": big });
  expect(() => parseIconset(declaring(zip, 100))).toThrow(ZipLimitError);
});

test("a well-formed zip still opens", () => {
  const zip = zipSync({ "a/a.cot": strToU8("<event/>"), "b.txt": strToU8("x") });
  expect(Object.keys(unzipLimited(zip, (path) => path.endsWith(".cot")))).toEqual(["a/a.cot"]);
});

test("a zip written as a stream, sizes after the data as Java writes them, opens", async () => {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const writer = new Zip((err, chunk) => {
    if (err) throw err;
    parts.push(chunk);
  });
  for (const [name, text] of [
    ["a/a.cot", "<event/>"],
    ["b/b.cot", "<event uid='b'/>"],
  ] as const) {
    const entry = new ZipDeflate(name);
    writer.add(entry);
    entry.push(strToU8(text), true);
  }
  writer.end();
  const files = unzipLimited(new Uint8Array(await new Blob(parts).arrayBuffer()), () => true);
  expect(strFromU8(files["b/b.cot"] as Uint8Array)).toBe("<event uid='b'/>");
});

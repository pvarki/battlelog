// @vitest-environment happy-dom
import { strToU8, zipSync } from "fflate";
import { expect, test, vi } from "vitest";
import { iconsetImage, iconsetPath, parseIconset } from "./iconsets.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const UID = "3c1f9a52-8d0e-4c41-9b0a-1a2d5e7f4b61";
const XML = strToU8(
  `<?xml version="1.0" encoding="UTF-8"?><iconset version="1" name="Retkeily" uid="${UID}" defaultFriendly="Retkeily/laavu.png"><icon name="laavu.png" type2525b="a-n-G-I"/></iconset>`,
);

test("an ATAK icon set: groups are top-level folders, paths resolve as markers name them", () => {
  const iconset = parseIconset(
    zipSync({
      "iconset.xml": XML,
      "Retkeily/nuotiopaikka.png": PNG,
      "Retkeily/laavu.png": PNG,
      "kartta.jpg": JPEG,
    }),
    1,
  );
  expect(iconset).toMatchObject({ uid: UID, name: "Retkeily", skipResize: false, imported: 1 });
  expect(iconset.icons.map((icon) => iconsetPath(iconset, icon)).sort()).toEqual([
    `${UID}/Other/kartta.jpg`,
    `${UID}/Retkeily/laavu.png`,
    `${UID}/Retkeily/nuotiopaikka.png`,
  ]);
  expect(iconset.icons.find((i) => i.file === "laavu.png")).toMatchObject({
    type: "a-n-G-I",
    mime: "image/png",
  });
});

test("only real PNG/JPEG images under safe paths, each file name once", () => {
  const iconset = parseIconset(
    zipSync({
      "iconset.xml": XML,
      "A/ok.png": PNG,
      "B/OK.png": PNG,
      "A/fake.png": strToU8("<script>"),
      "A/notes.txt": strToU8("x"),
      "A/../evil.png": PNG,
      "__MACOSX/A/._ok.png": strToU8("\0\u0005\u0016\u0007"),
    }),
  );
  expect(iconset.icons.map((i) => `${i.group}/${i.file}`)).toEqual(["A/ok.png"]);
});

test("rejects what isn't an icon set", () => {
  expect(() => parseIconset(strToU8("not a zip"))).toThrow("Not a zip file");
  expect(() => parseIconset(zipSync({ "A/ok.png": PNG }))).toThrow("No iconset.xml");
  expect(() =>
    parseIconset(zipSync({ "iconset.xml": strToU8('<iconset name="x"/>'), "A/ok.png": PNG })),
  ).toThrow("no valid uid");
  expect(() => parseIconset(zipSync({ "iconset.xml": XML, "A/notes.txt": PNG }))).toThrow(
    "no PNG or JPEG",
  );
  expect(() => parseIconset(new Uint8Array(21 * 1024 * 1024))).toThrow("larger than 20 MB");
});

test("oversized icons are never inflated", () => {
  const big = new Uint8Array(2 * 1024 * 1024);
  big.set(PNG);
  expect(() => parseIconset(zipSync({ "iconset.xml": XML, "A/big.png": big }))).toThrow(
    "no PNG or JPEG",
  );
});

test("icons of sets not imported come from TAK, and a miss is asked for once", async () => {
  const fetch = vi.fn(async (_url: string) => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  const path = "not-imported/Group/missing.png";
  await vi.waitFor(() => {
    iconsetImage(path);
    expect(fetch).toHaveBeenCalledOnce();
  });
  await new Promise((resolve) => setTimeout(resolve));
  expect(iconsetImage(path)).toBeUndefined();
  iconsetImage("COT_MAPPING_SPOTMAP/b-m-p-s-m/-65536");
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[0]).toMatch(
    /\/Marti\/api\/icon\/not-imported\/Group\/missing\.png$/,
  );
  vi.unstubAllGlobals();
});

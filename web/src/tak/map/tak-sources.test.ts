// @vitest-environment happy-dom
import { strToU8, zipSync } from "fflate";
import { expect, test, vi } from "vitest";
import { mapLayerSources, profileSources } from "./tak-sources.ts";

const layer = {
  uid: "a1",
  creatorUid: "admin",
  name: "Ortho",
  type: "XYZ",
  url: "https://{$serverpart}.tiles.example/{$z}/{$x}/{$y}.jpg",
  tileType: "jpg",
  serverParts: "a b",
  minZoom: 2,
  maxZoom: 18,
  defaultLayer: false,
  enabled: true,
  invertYCoordinate: false,
  opacity: null,
};

test("TAK map layers become read-only sources; disabled and unusable ones are left out", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const sources = mapLayerSources([
    layer,
    { ...layer, uid: "off", enabled: false },
    {
      ...layer,
      uid: "wms",
      name: "Roads",
      type: "WMS",
      url: "https://wms.example/ows",
      layers: "roads",
    },
    { ...layer, uid: "bad", name: "Bad", url: "https://tiles.example/whole-world.png" },
  ]);
  expect(sources.map((s) => [s.id, s.origin])).toEqual([
    ["tak:layer:a1", "tak"],
    ["tak:layer:wms", "tak"],
  ]);
  expect(sources[0]?.spec).toMatchObject({
    tiles: ["https://a.tiles.example/{z}/{x}/{y}.jpg", "https://b.tiles.example/{z}/{x}/{y}.jpg"],
    minzoom: 2,
    maxzoom: 18,
    scheme: "xyz",
  });
  expect(sources[1]?.spec.tiles?.[0]).toContain("LAYERS=roads");
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});

test("a device profile's map source files become sources; its other files are ignored", () => {
  const zip = zipSync({
    "MANIFEST/manifest.xml": strToU8("<MissionPackageManifest/>"),
    "file1/Topo.xml": strToU8(
      "<customMapSource><name>Topo</name><minZoom>0</minZoom><maxZoom>16</maxZoom><tileType>png</tileType><url>https://t.example/{$z}/{$x}/{$y}.png</url></customMapSource>",
    ),
    "file2/prefs.pref": strToU8("<preferences/>"),
    "file3/other.xml": strToU8("<something/>"),
  });
  expect(profileSources(zip)).toEqual([
    {
      id: "tak:profile:file1/Topo.xml",
      label: "Topo",
      origin: "tak",
      spec: {
        type: "raster",
        tiles: ["https://t.example/{z}/{x}/{y}.png"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 16,
        scheme: "xyz",
      },
    },
  ]);
});

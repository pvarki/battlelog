// @vitest-environment happy-dom
import { describe, expect, it, test } from "vitest";
import { isCustomSource, MapSourceError, parseAtakMapSource, tileUrls } from "./custom-sources.ts";

describe("tileUrls", () => {
  it("reads ATAK placeholders and expands server parts", () => {
    expect(tileUrls("https://{$serverpart}.tile.example/{$z}/{$x}/{$y}.png", ["a", "b"])).toEqual({
      tiles: ["https://a.tile.example/{z}/{x}/{y}.png", "https://b.tile.example/{z}/{x}/{y}.png"],
      scheme: "xyz",
    });
  });

  it("turns {-y} into a TMS source and {$q} into a quadkey", () => {
    expect(tileUrls("https://t.example/{z}/{x}/{-y}.jpg").scheme).toBe("tms");
    expect(tileUrls("https://t.example/q/{$q}.jpg").tiles).toEqual([
      "https://t.example/q/{quadkey}.jpg",
    ]);
  });

  it("rejects addresses without tile placeholders or a web scheme", () => {
    expect(() => tileUrls("https://t.example/map.png")).toThrow(MapSourceError);
    expect(() => tileUrls("file:///{z}/{x}/{y}.png")).toThrow(MapSourceError);
  });
});

describe("parseAtakMapSource", () => {
  it("reads a customMapSource", () => {
    const xml = `<?xml version="1.0"?>
      <customMapSource>
        <name>Google Hybrid</name><minZoom>2</minZoom><maxZoom>20</maxZoom>
        <tileType>png</tileType><tileUpdate>False</tileUpdate>
        <url>https://mt1.example/vt/lyrs=y&amp;x={$x}&amp;y={$y}&amp;z={$z}</url>
        <backgroundColor>#000000</backgroundColor>
      </customMapSource>`;
    expect(parseAtakMapSource(xml, "id")).toEqual({
      id: "id",
      label: "Google Hybrid",
      tiles: ["https://mt1.example/vt/lyrs=y&x={x}&y={y}&z={z}"],
      minzoom: 2,
      maxzoom: 20,
      scheme: "xyz",
    });
  });

  it("reads a Web Mercator WMS source and refuses other projections", () => {
    const wms = (crs: string) => `<customWmsMapSource>
        <name>Kiinteistöt</name><url>https://wms.example/ows</url>
        <layers>kiinteistot</layers><coordinateSystem>${crs}</coordinateSystem>
      </customWmsMapSource>`;
    const [tile] = parseAtakMapSource(wms("EPSG:3857"), "id").tiles;
    expect(tile).toMatch(
      /^https:\/\/wms\.example\/ows\?SERVICE=WMS&.*LAYERS=kiinteistot.*&BBOX=\{bbox-epsg-3857\}$/,
    );
    expect(() => parseAtakMapSource(wms("EPSG:3067"), "id")).toThrow(/Web Mercator/);
  });

  it("rejects files that aren't map sources", () => {
    expect(() => parseAtakMapSource("<kml/>", "id")).toThrow(MapSourceError);
  });
});

test("a malformed stored source is skipped rather than breaking the map", () => {
  const good = {
    id: "a",
    label: "A",
    tiles: ["https://t/{z}/{x}/{y}.png"],
    minzoom: 0,
    maxzoom: 18,
    scheme: "xyz",
  };
  expect([null, {}, { ...good, tiles: [] }, good].filter(isCustomSource)).toEqual([good]);
});

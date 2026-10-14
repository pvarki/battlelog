import { expect, test } from "vitest";
import { areaPlan, MAX_AREA_TILES, tilesIn, tileUrl } from "./offline-area.ts";

const HELSINKI = { west: 24.9, south: 60.15, east: 24.98, north: 60.19 };

test("the tiles covering an area at a zoom", () => {
  // 24.9°E–24.98°E straddles the x = 582/583 tile edge at zoom 10.
  expect(tilesIn(HELSINKI, 10)).toEqual([
    { z: 10, x: 582, y: 296 },
    { z: 10, x: 583, y: 296 },
  ]);
  expect(tilesIn(HELSINKI, 14)).toHaveLength(4 * 5);
});

test("an area plan stops at the zoom where the tile count would pass the cap", () => {
  const plan = areaPlan(HELSINKI, 12, 19);
  expect(plan.fromZoom).toBe(12);
  expect(plan.tiles.length).toBeLessThanOrEqual(MAX_AREA_TILES);
  expect(plan.toZoom).toBeGreaterThan(12);
  expect(plan.toZoom).toBeLessThan(19);
});

test("tile URLs fill XYZ, TMS, quadkey and WMS bbox templates", () => {
  const tile = { z: 2, x: 1, y: 1 };
  expect(tileUrl("https://t/{z}/{x}/{y}.png", tile)).toBe("https://t/2/1/1.png");
  expect(tileUrl("https://t/{z}/{x}/{y}.png", tile, "tms")).toBe("https://t/2/1/2.png");
  expect(tileUrl("https://t/q/{quadkey}", tile)).toBe("https://t/q/03");
  expect(tileUrl("https://w?BBOX={bbox-epsg-3857}", { z: 0, x: 0, y: 0 })).toBe(
    "https://w?BBOX=-20037508.342789244,-20037508.342789244,20037508.342789244,20037508.342789244",
  );
});

import type { LineString, Point, Position } from "geojson";
import proj4 from "proj4";
import { expect, test } from "vitest";
import { type Bounds, clipPolyline, mgrsGrid } from "./mgrs-grid.ts";

const ZONE_35 = "+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs";
const HELSINKI: Bounds = { west: 24.85, south: 60.12, east: 25.05, north: 60.22 };

const linesOf = (view: Bounds, zoom: number, level?: string) =>
  mgrsGrid(view, zoom)
    .features.filter((f) => f.geometry.type === "LineString")
    .filter((f) => !level || f.properties?.level === level)
    .map((f) => (f.geometry as LineString).coordinates);

const labelsOf = (view: Bounds, zoom: number) =>
  mgrsGrid(view, zoom)
    .features.filter((f) => f.geometry.type === "Point")
    .map((f) => f.properties?.text as string);

test("1 km lines over Helsinki fall on whole kilometres of UTM zone 35", () => {
  const lines = linesOf(HELSINKI, 12, "1km");
  expect(lines.length).toBeGreaterThan(10);
  for (const line of lines) {
    const [e, n] = proj4("WGS84", ZONE_35, line[Math.floor(line.length / 2)] as Position);
    const offKm = Math.min(
      Math.abs((e as number) - Math.round((e as number) / 1000) * 1000),
      Math.abs((n as number) - Math.round((n as number) / 1000) * 1000),
    );
    expect(offKm).toBeLessThan(0.01);
  }
});

test("Helsinki is labelled with its 100 km square and its kilometre digits", () => {
  const labels = labelsOf(HELSINKI, 12);
  expect(labels).toContain("LG");
  expect(labels).toContain("85");
});

test("no grid line crosses a zone edge", () => {
  const acrossEdge: Bounds = { west: 23.9, south: 60.1, east: 24.1, north: 60.2 };
  const lines = linesOf(acrossEdge, 12).filter((l) => l.length > 5);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    const west = line.every(([lon]) => (lon as number) <= 24 + 1e-9);
    const east = line.every(([lon]) => (lon as number) >= 24 - 1e-9);
    expect(west || east).toBe(true);
  }
});

test("grid zone 32V starts at 3°E, Norway's exception", () => {
  const outlines = linesOf({ west: 0, south: 57, east: 12, north: 63 }, 4, "gzd");
  expect(outlines).toContainEqual(expect.arrayContaining([[3, 56]]));
  expect(labelsOf({ west: 0, south: 57, east: 12, north: 63 }, 4)).toEqual(["31V", "32V"]);
});

test("zoomed out, only grid zones are drawn", () => {
  const levels = mgrsGrid({ west: 15, south: 55, east: 35, north: 70 }, 5).features.map(
    (f) => f.properties?.level ?? (f.geometry as Point).type,
  );
  expect(new Set(levels)).toEqual(new Set(["gzd", "Point"]));
});

test("a polyline leaving and re-entering the box is cut into pieces at its edges", () => {
  const box = { west: 0, south: 0, east: 10, north: 10 };
  const pieces = clipPolyline(
    [
      [-5, 5],
      [5, 5],
      [15, 5],
      [15, 8],
      [5, 8],
    ],
    box,
  );
  expect(pieces).toEqual([
    [
      [0, 5],
      [5, 5],
      [10, 5],
    ],
    [
      [10, 8],
      [5, 8],
    ],
  ]);
});

import type { Feature } from "geojson";
import { expect, test } from "vitest";
import { sensorCone, sourceDiff } from "./layers.ts";

test("a sensor cone is a closed wedge from the sensor, its edges fov apart around the azimuth", () => {
  const origin: [number, number] = [25, 60];
  const cone = sensorCone(origin, {
    azimuth: 90,
    fov: 60,
    range: 1000,
    fill: { color: "#ffffff", opacity: 0.3 },
    stroke: { color: "#cccccc", opacity: 1 },
  });
  expect(cone[0]).toEqual(origin);
  expect(cone.at(-1)).toEqual(origin);
  const [left, right] = [cone[1] as [number, number], cone.at(-2) as [number, number]];
  // Edges at 60° and 120°: both east of the sensor, near-mirrored across its latitude.
  expect(left[0]).toBeGreaterThan(25);
  expect(left[1] - 60).toBeGreaterThan(0);
  expect(left[1] - 60).toBeCloseTo(60 - right[1], 4);
});

import { tacticalOverlayColors } from "./layers.ts";

test("ATAK's tactical overlay: left/right as seen looking out of the front, so a south front has red east", () => {
  // Corners counter-clockwise from south-west: front = south wall.
  const square: [number, number][] = [
    [22.0, 60.0],
    [22.001, 60.0],
    [22.001, 60.0005],
    [22.0, 60.0005],
    [22.0, 60.0],
  ];
  // Walls: south (front), east, north (back), west.
  expect(tacticalOverlayColors(square)).toEqual(["#ffffff", "#ff0000", "#000000", "#00ff00"]);
  // Same building drawn clockwise from south-east; walls: south, west, north, east.
  const clockwise = [square[1], square[0], square[3], square[2], square[1]] as [number, number][];
  expect(tacticalOverlayColors(clockwise)).toEqual(["#ffffff", "#00ff00", "#000000", "#ff0000"]);
});

const dot = (n: number): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [n, n] },
  properties: {},
});
const drawing = (points: Feature[]) => ({
  points,
  shapes: [],
  markerLabels: [],
  lineLabels: [],
  decorations: [],
  tactical: [],
});

test("a source diff sends only what changed: new and changed items, and ids an item lost", () => {
  const still = drawing([dot(1)]);
  const before = new Map([
    ["a", still],
    ["b", drawing([dot(2), dot(3)])],
    ["gone", drawing([dot(4)])],
  ]);
  const after = new Map([
    ["a", still],
    ["b", drawing([dot(5)])],
    ["new", drawing([dot(6)])],
  ]);
  const { add, remove } = sourceDiff(before, after, "points");
  expect(add.map((f) => f.id)).toEqual(["b\u00000", "new\u00000"]);
  expect(remove).toEqual(["b\u00001", "gone\u00000"]);
  expect(sourceDiff(after, after, "points")).toEqual({ add: [], remove: [] });
});

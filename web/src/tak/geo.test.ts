import { expect, test } from "vitest";
import type { Position } from "./cot.ts";
import { area } from "./geo.ts";

const EARTH_RADIUS_M = 6_371_008.8;

test("an octant of the sphere is an eighth of its surface", () => {
  const octant = area([
    [0, 0],
    [90, 0],
    [0, 90],
  ]);
  expect(octant / ((4 * Math.PI * EARTH_RADIUS_M ** 2) / 8)).toBeCloseTo(1, 9);
});

test("a square kilometre near Helsinki, in either winding, closed or not", () => {
  const north = 1 / 111.195;
  const east = north / Math.cos((60 * Math.PI) / 180);
  const square: Position[] = [
    [25, 60],
    [25 + east, 60],
    [25 + east, 60 + north],
    [25, 60 + north],
  ];
  expect(area(square) / 1e6).toBeCloseTo(1, 2);
  expect(area([...square].reverse())).toBeCloseTo(area(square), 3);
  expect(area([...square, square[0] as Position])).toBeCloseTo(area(square), 3);
});

test("fewer than three points enclose nothing", () => {
  expect(area([])).toBe(0);
  expect(
    area([
      [25, 60],
      [26, 61],
    ]),
  ).toBeCloseTo(0, 3);
});

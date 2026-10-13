import { expect, test } from "vitest";
import { bearing, distance } from "../geo.ts";
import { formatBearing, legsOf, totalDistance } from "./measure.ts";

test("bearings are degrees true from the first point", () => {
  expect(bearing([25, 60], [25, 61])).toBeCloseTo(0);
  expect(bearing([25, 60], [26, 60])).toBeCloseTo(89.57, 1);
  expect(bearing([25, 60], [25, 59])).toBeCloseTo(180);
  expect(bearing([25, 60], [24, 60])).toBeCloseTo(270.43, 1);
});

test("a degree of latitude is about 111 km", () => {
  expect(distance([25, 60], [25, 61])).toBeCloseTo(111_195, -1);
});

test("legs measure each segment and the total adds them up", () => {
  const legs = legsOf([
    [25, 60],
    [25, 61],
    [25, 60],
  ]);
  expect(legs.map((l) => Math.round(l.bearing))).toEqual([0, 180]);
  expect(totalDistance(legs)).toBeCloseTo(2 * 111_195, -1);
  expect(legsOf([[25, 60]])).toEqual([]);
});

test("bearings read in degrees and 6400 mils, wrapping at north", () => {
  expect(formatBearing(45)).toBe("45°T · 0800 mils");
  expect(formatBearing(359.9)).toBe("0°T · 6398 mils");
  expect(formatBearing(359.99)).toBe("0°T · 0000 mils");
  expect(formatBearing(270)).toBe("270°T · 4800 mils");
});

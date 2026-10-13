import { expect, test } from "vitest";
import { formatDistance, sensorCone } from "./layers.ts";

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

test("distances read like ATAK's measurement labels", () => {
  expect(formatDistance(250.4)).toBe("250 m");
  expect(formatDistance(1234)).toBe("1.23 km");
  expect(formatDistance(12_345)).toBe("12.3 km");
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

import proj4 from "proj4";
import { expect, test } from "vitest";
import type { Position } from "./cot.ts";
import { utm } from "./utm.ts";

const cases: [number, boolean, Position][] = [
  [35, false, [24.9384, 60.1699]],
  [35, false, [19.5, 59.8]],
  [35, false, [31.5, 70.1]],
  [35, false, [27, 0]],
  [33, false, [12.1, 78.2]],
  [19, true, [-70.6, -33.4]],
];

test("matches proj4 to a millimetre, both ways", () => {
  for (const [zone, south, lonLat] of cases) {
    const reference = proj4(
      "WGS84",
      `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84`,
    );
    const projection = utm(zone, south);
    const [e, n] = projection.forward(lonLat);
    const [re, rn] = reference.forward(lonLat);
    expect(Math.abs(e - re)).toBeLessThan(0.001);
    expect(Math.abs(n - rn)).toBeLessThan(0.001);
    const [lon, lat] = projection.inverse([e, n]);
    expect(Math.abs(lon - lonLat[0])).toBeLessThan(1e-8);
    expect(Math.abs(lat - lonLat[1])).toBeLessThan(1e-8);
  }
});

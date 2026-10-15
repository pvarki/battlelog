import type { Position } from "./cot.ts";

// Krüger's n-series to 4th order, as JHS 154 specifies for ETRS-TM35FIN: well under
// a millimetre across a zone and beyond. Small enough to keep proj4 off the map page.
const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const FALSE_EASTING = 500_000;
const FALSE_NORTHING_SOUTH = 10_000_000;

const N = F / (2 - F);
const E = Math.sqrt(F * (2 - F));
const A1 = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const H = [
  N / 2 - (2 / 3) * N ** 2 + (5 / 16) * N ** 3 + (41 / 180) * N ** 4,
  (13 / 48) * N ** 2 - (3 / 5) * N ** 3 + (557 / 1440) * N ** 4,
  (61 / 240) * N ** 3 - (103 / 140) * N ** 4,
  (49561 / 161280) * N ** 4,
];
const H_INVERSE = [
  N / 2 - (2 / 3) * N ** 2 + (37 / 96) * N ** 3 - (1 / 360) * N ** 4,
  (1 / 48) * N ** 2 + (1 / 15) * N ** 3 - (437 / 1440) * N ** 4,
  (17 / 480) * N ** 3 - (37 / 840) * N ** 4,
  (4397 / 161280) * N ** 4,
];

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

const series = (xi: number, eta: number, h: number[], sign: 1 | -1): [number, number] =>
  h.reduce<[number, number]>(
    ([x, y], hj, i) => {
      const k = 2 * (i + 1);
      return [
        x + sign * hj * Math.sin(k * xi) * Math.cosh(k * eta),
        y + sign * hj * Math.cos(k * xi) * Math.sinh(k * eta),
      ];
    },
    [xi, eta],
  );

/** UTM on WGS84 (GRS80 differs by well under a millimetre), as [lon, lat] ⇄ [easting, northing]. */
export const utm = (zone: number, south: boolean) => {
  const lon0 = toRad(zone * 6 - 183);
  const northing0 = south ? FALSE_NORTHING_SOUTH : 0;
  return {
    forward: ([lon, lat]: Position): Position => {
      const phi = toRad(lat);
      const dLon = toRad(lon) - lon0;
      const q = Math.asinh(Math.tan(phi)) - E * Math.atanh(E * Math.sin(phi));
      const beta = Math.atan(Math.sinh(q));
      const [xi, eta] = series(
        Math.atan2(Math.tan(beta), Math.cos(dLon)),
        Math.atanh(Math.cos(beta) * Math.sin(dLon)),
        H,
        1,
      );
      return [FALSE_EASTING + A1 * K0 * eta, northing0 + A1 * K0 * xi];
    },
    inverse: ([easting, northing]: Position): Position => {
      const [xi, eta] = series(
        (northing - northing0) / (A1 * K0),
        (easting - FALSE_EASTING) / (A1 * K0),
        H_INVERSE,
        -1,
      );
      const beta = Math.asin(Math.sin(xi) / Math.cosh(eta));
      const q = Math.asinh(Math.tan(beta));
      let qPrime = q;
      for (let i = 0; i < 5; i++) qPrime = q + E * Math.atanh(E * Math.tanh(qPrime));
      return [
        toDeg(lon0 + Math.atan2(Math.sinh(eta), Math.cos(xi))),
        toDeg(Math.atan(Math.sinh(qPrime))),
      ];
    },
  };
};

import type { Position } from "./cot.ts";

/** A longitude/latitude rectangle. */
export type Bounds = { west: number; south: number; east: number; north: number };

export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;
/** Finnish Defence Forces mils (piirua), not NATO's 6400; one full turn. */
export const MILS_PER_TURN = 6000;

/** Ground distance in metres, haversine. */
export const distance = ([lon1, lat1]: Position, [lon2, lat2]: Position): number => {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
};

export const formatDistance = (metres: number): string =>
  metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(metres < 10_000 ? 2 : 1)} km`;

/** Initial great-circle bearing from `from` to `to`, degrees true in [0, 360). */
export const bearing = ([lon1, lat1]: Position, [lon2, lat2]: Position): number => {
  const dLon = (lon2 - lon1) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * RAD);
  const x =
    Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
    Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLon);
  return (((Math.atan2(y, x) / RAD) % 360) + 360) % 360;
};

export const toMils = (degrees: number): number => (degrees / 360) * MILS_PER_TURN;

/**
 * Area in square metres enclosed by `ring` (closed or not) with great-circle
 * edges: the sum of each edge's signed spherical excess against the equator.
 */
export const area = (ring: Position[]): number => {
  let excess = 0;
  for (const [i, [lon1, lat1]] of ring.entries()) {
    const [lon2, lat2] = ring[(i + 1) % ring.length] as Position;
    const t1 = Math.tan((lat1 * RAD) / 2);
    const t2 = Math.tan((lat2 * RAD) / 2);
    excess += 2 * Math.atan2(Math.tan(((lon2 - lon1) * RAD) / 2) * (t1 + t2), 1 + t1 * t2);
  }
  return Math.abs(excess) * EARTH_RADIUS_M ** 2;
};

import type { Position } from "./cot.ts";

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;
/** NATO mils; one full turn. */
export const MILS_PER_TURN = 6400;

/** Ground distance in metres, haversine. */
export const distance = ([lon1, lat1]: Position, [lon2, lat2]: Position): number => {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
};

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

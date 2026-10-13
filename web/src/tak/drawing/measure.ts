import type { Position } from "../cot.ts";
import { bearing, distance, MILS_PER_TURN, toMils } from "../geo.ts";

/** One straight segment of a measurement: metres and degrees true. */
export type Leg = { distance: number; bearing: number };

export const legsOf = (points: Position[]): Leg[] =>
  points.slice(1).map((to, i) => {
    const from = points[i] as Position;
    return { distance: distance(from, to), bearing: bearing(from, to) };
  });

export const totalDistance = (legs: Leg[]): number => legs.reduce((sum, l) => sum + l.distance, 0);

/** "45°T · 0800 mils", as range-and-bearing readouts show it. */
export const formatBearing = (degrees: number): string => {
  const mils = Math.round(toMils(degrees)) % MILS_PER_TURN;
  return `${Math.round(degrees) % 360}°T · ${String(mils).padStart(4, "0")} mils`;
};

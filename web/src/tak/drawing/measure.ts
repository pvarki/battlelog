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

/** The length around the area the points enclose, back to the first point. */
export const perimeter = (points: Position[]): number =>
  totalDistance(legsOf([...points, points[0] as Position]));

/** "07-50", mils written the Finnish way. */
export const formatMils = (degrees: number): string => {
  const mils = Math.round(toMils(degrees)) % MILS_PER_TURN;
  const digits = String(mils).padStart(4, "0");
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
};

/** "45°T · 07-50 mils". */
export const formatBearing = (degrees: number): string =>
  `${Math.round(degrees) % 360}°T · ${formatMils(degrees)} mils`;

const SQUARE_METRES_PER_HECTARE = 10_000;
const SQUARE_METRES_PER_KM2 = 1_000_000;

export const formatArea = (squareMetres: number): string =>
  squareMetres < SQUARE_METRES_PER_HECTARE
    ? `${Math.round(squareMetres)} m²`
    : squareMetres < SQUARE_METRES_PER_KM2
      ? `${(squareMetres / SQUARE_METRES_PER_HECTARE).toFixed(2)} ha`
      : `${(squareMetres / SQUARE_METRES_PER_KM2).toFixed(2)} km²`;

import { type Bullseye, destination, type Position } from "../cot.ts";
import { formatMils } from "../drawing/measure.ts";

/** A bullseye has a labelled spoke every 30° and a tick every 10° between them. */
const SPOKE_EVERY = 30;
const TICK_EVERY = 10;
const TICK_LENGTH = 0.05;
const LABEL_DISTANCE = 1.12;
/** Halfway between two spokes, where a ring's distance label doesn't sit on a spoke or its bearing. */
export const BETWEEN_SPOKES = SPOKE_EVERY / 2;
const CIRCLE_STEPS = 128;

export const ringRadii = (spacing: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => spacing * (i + 1));

/** A geodesic circle as a closed line. */
export const circleLine = (centre: Position, radius: number): Position[] =>
  Array.from({ length: CIRCLE_STEPS + 1 }, (_, i) =>
    destination(centre, radius, (i * 360) / CIRCLE_STEPS),
  );

/** The bullseye's circle and its range rings, innermost first. */
export const bullseyeRadii = ({ radius, rings }: Bullseye): number[] =>
  [...(rings ? ringRadii(rings.spacing, rings.count) : []), radius].sort((a, b) => a - b);

/** "030" in degrees, "05-00" in Finnish mils. */
const bearingText = (degrees: number, mils: boolean) =>
  mils ? formatMils(degrees) : String(Math.round(degrees) % 360).padStart(3, "0");

/**
 * The bullseye's spokes and ticks, and each spoke's bearing just outside the
 * circle. Read from the edge in to the centre, a spoke shows its back bearing.
 */
export const bullseyeMarks = (
  centre: Position,
  bullseye: Bullseye,
): { lines: Position[][]; labels: { at: Position; text: string }[] } => {
  const { radius, mils, edgeToCenter } = bullseye;
  const lines: Position[][] = [];
  const labels: { at: Position; text: string }[] = [];
  for (let bearing = 0; bearing < 360; bearing += TICK_EVERY) {
    const edge = destination(centre, radius, bearing);
    if (bearing % SPOKE_EVERY !== 0) {
      lines.push([destination(centre, radius * (1 - TICK_LENGTH), bearing), edge]);
      continue;
    }
    lines.push([centre, edge]);
    labels.push({
      at: destination(centre, radius * LABEL_DISTANCE, bearing),
      text: bearingText(edgeToCenter ? (bearing + 180) % 360 : bearing, mils),
    });
  }
  return { lines, labels };
};

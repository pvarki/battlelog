import { expect, test } from "vitest";
import type { Bullseye, Position } from "../cot.ts";
import { distance } from "../geo.ts";
import { bullseyeMarks, bullseyeRadii, circleLine } from "./rings.ts";

const centre: Position = [25, 60];
const bullseye: Bullseye = { radius: 1000, mils: false, northRef: "T", edgeToCenter: false };

test("a circle is closed and every point is the radius away", () => {
  const ring = circleLine(centre, 750);
  expect(ring[0]?.[0]).toBeCloseTo(ring.at(-1)?.[0] ?? 0, 9);
  for (const p of ring) expect(distance(centre, p)).toBeCloseTo(750, 3);
});

test("a bullseye's rings sit inside its circle, innermost first", () => {
  expect(bullseyeRadii(bullseye)).toEqual([1000]);
  expect(bullseyeRadii({ ...bullseye, rings: { spacing: 300, count: 3 } })).toEqual([
    300, 600, 900, 1000,
  ]);
});

test("spokes every 30° are labelled with their bearing, ticks fill in every 10°", () => {
  const { lines, labels } = bullseyeMarks(centre, bullseye);
  expect(lines).toHaveLength(36);
  expect(labels.map((l) => l.text)).toEqual([
    "000",
    "030",
    "060",
    "090",
    "120",
    "150",
    "180",
    "210",
    "240",
    "270",
    "300",
    "330",
  ]);
  expect(distance(centre, labels[0]?.at ?? centre)).toBeGreaterThan(1000);
});

test("from the edge to the centre a spoke reads its back bearing, in mils if asked", () => {
  const { labels } = bullseyeMarks(centre, { ...bullseye, mils: true, edgeToCenter: true });
  expect(labels[0]?.text).toBe("30-00");
  expect(labels[3]?.text).toBe("45-00");
});

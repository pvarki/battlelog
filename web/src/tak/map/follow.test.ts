import { expect, test } from "vitest";
import type { TakItem } from "../cot.ts";
import { allInView, boundsOf, followedItems, positionsOf } from "./follow.ts";

const item = (uid: string, extra: Partial<TakItem> = {}): TakItem => ({
  uid,
  type: "a-f-G",
  time: 1000,
  stale: 2000,
  geometry: { type: "Point", coordinates: [25, 60] },
  event: {} as TakItem["event"],
  ...extra,
});

test("follows items by callsign, mission membership or overlay group", () => {
  const items = [
    item("alpha", { callsign: "Alpha", team: "Cyan" }),
    item("bravo", { callsign: "Bravo", team: "Cyan" }),
    item("hostile", { type: "a-h-G" }),
    item("line", { type: "u-d-f" }),
  ];
  const uids = (follow: Parameters<typeof followedItems>[1], mission: string[] = []) =>
    followedItems(items, follow, new Set(mission)).map((i) => i.uid);
  expect(uids({ callsigns: ["Bravo"] })).toEqual(["bravo"]);
  expect(uids({}, ["line"])).toEqual(["line"]);
  expect(uids({ groups: ["markers/team"] })).toEqual(["alpha", "bravo"]);
  expect(uids({ groups: ["markers/hostile"], callsigns: ["Alpha"] })).toEqual(["alpha", "hostile"]);
});

test("an item without a position fix isn't followed", () => {
  const noFix = item("nofix", {
    callsign: "Alpha",
    geometry: { type: "Point", coordinates: [0, 0] },
  });
  expect(followedItems([noFix], { callsigns: ["Alpha"] }, new Set())).toEqual([]);
});

test("the bounds take in every vertex of points, lines and areas", () => {
  const positions = positionsOf([
    item("p", { geometry: { type: "Point", coordinates: [25, 60] } }),
    item("l", {
      geometry: {
        type: "LineString",
        coordinates: [
          [24, 61],
          [26, 61],
        ],
      },
    }),
    item("a", {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [25, 59],
            [25.5, 62],
            [25, 59],
          ],
        ],
      },
    }),
  ]);
  expect(boundsOf(positions)).toEqual([
    [24, 59],
    [26, 62],
  ]);
  expect(boundsOf([])).toBeUndefined();
});

test("the view holds while every point stays clear of the edge", () => {
  const inView = (x: number, y: number) =>
    allInView(
      [
        { x: 50, y: 50 },
        { x, y },
      ],
      200,
      100,
      20,
    );
  expect(inView(150, 70)).toBe(true);
  expect(inView(190, 50)).toBe(false);
  expect(inView(50, -5)).toBe(false);
});

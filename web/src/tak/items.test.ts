import { expect, test } from "vitest";
import type { TakItem } from "./cot.ts";
import {
  activeBreachAlerts,
  activeEmergencies,
  describeType,
  extentOf,
  unitStatusOf,
  withUnitStatus,
} from "./items.ts";

test("status goes in the 4th character of a 2525C code", () => {
  expect(withUnitStatus("SHGPU----------", "destroyed")).toBe("SHGXU----------");
  expect(unitStatusOf("SHGXU----------")).toBe("destroyed");
  expect(unitStatusOf("SHGPU----------")).toBe("present");
});

test("status goes in the 7th digit of a 2525D code", () => {
  const sidc = "10061000001211000000";
  expect(withUnitStatus(sidc, "damaged")).toBe("10061030001211000000");
  expect(unitStatusOf("10061040001211000000")).toBe("destroyed");
});

test("only emergencies that haven't gone stale are active, newest first", () => {
  const item = (uid: string, time: number, stale: number, emergency = true) =>
    ({
      uid,
      time,
      stale,
      ...(emergency && { emergency: { kind: "911 Alert", from: uid } }),
    }) as TakItem;
  const items = [
    item("old", 100, 2000),
    item("stale", 300, 900),
    item("new", 200, 2000),
    item("marker", 400, 2000, false),
  ];
  expect(activeEmergencies(items, 1000).map((i) => i.uid)).toEqual(["new", "old"]);
});

test("geofence breaches are alerts apart from emergencies", () => {
  const items = [
    { uid: "911", type: "b-a-o-tbl", time: 1, stale: 2000, emergency: { kind: "911", from: "A" } },
    { uid: "fence", type: "b-a-g", time: 2, stale: 2000, emergency: { kind: "Breach", from: "B" } },
  ] as TakItem[];
  expect(activeEmergencies(items, 1000).map((i) => i.uid)).toEqual(["911"]);
  expect(activeBreachAlerts(items, 1000).map((i) => i.uid)).toEqual(["fence"]);
});

test("a closed ATAK line is an area, an open one a line", () => {
  const drawing = (geometry: TakItem["geometry"]) =>
    ({ uid: "d", type: "u-d-f", time: 0, stale: 0, geometry }) as TakItem;
  const ring: [number, number][] = [
    [25, 60],
    [25.1, 60],
    [25.1, 60.1],
    [25, 60],
  ];
  expect(describeType(drawing({ type: "Polygon", coordinates: [ring] }))).toBe("Area");
  expect(describeType(drawing({ type: "LineString", coordinates: ring.slice(0, 3) }))).toBe("Line");
});

test("a shape's extent covers its vertices, a circle its radius, and a marker none", () => {
  const item = (geometry: TakItem["geometry"], extra: Partial<TakItem> = {}) =>
    ({ uid: "i", type: "u-d-f", time: 0, stale: 0, geometry, ...extra }) as TakItem;
  const line = item({
    type: "LineString",
    coordinates: [
      [25, 60],
      [25.2, 60.1],
    ],
  });
  expect(extentOf(line)).toEqual([
    [25, 60],
    [25.2, 60.1],
  ]);
  const circle = item(
    { type: "Point", coordinates: [25, 60] },
    { ellipse: { major: 1000, minor: 1000, angle: 0 } },
  );
  const [[west, south], [east, north]] = extentOf(circle) ?? [
    [0, 0],
    [0, 0],
  ];
  expect(north - south).toBeCloseTo(2000 / 111_195, 3);
  expect(east).toBeGreaterThan(25);
  expect(west).toBeLessThan(25);
  expect(extentOf(item({ type: "Point", coordinates: [25, 60] }))).toBeUndefined();
});

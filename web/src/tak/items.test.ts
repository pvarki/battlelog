import { expect, test } from "vitest";
import type { TakItem } from "./cot.ts";
import { activeEmergencies, unitStatusOf, withUnitStatus } from "./items.ts";

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

import { expect, test } from "vitest";
import { unitStatusOf, withUnitStatus } from "./items.ts";

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

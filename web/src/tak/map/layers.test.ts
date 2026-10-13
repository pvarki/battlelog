import { expect, test } from "vitest";
import { formatDistance } from "./layers.ts";

test("distances read like ATAK's measurement labels", () => {
  expect(formatDistance(250.4)).toBe("250 m");
  expect(formatDistance(1234)).toBe("1.23 km");
  expect(formatDistance(12_345)).toBe("12.3 km");
});

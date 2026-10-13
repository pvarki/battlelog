import { expect, test } from "vitest";
import descriptor from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("empty config gets the default tools and no pinned view", () => {
  expect(descriptor.configSchema.parse({})).toEqual({ tools: ["layers", "search"] });
});

test("unknown tools and out-of-range views are rejected", () => {
  expect(descriptor.configSchema.safeParse({ tools: ["teleport"] }).success).toBe(false);
  expect(
    descriptor.configSchema.safeParse({ view: { center: [22, 95], zoom: 10, bearing: 0 } }).success,
  ).toBe(false);
  expect(
    descriptor.configSchema.safeParse({ view: { center: [22.3, 60.4], zoom: 12, bearing: 30 } })
      .success,
  ).toBe(true);
});

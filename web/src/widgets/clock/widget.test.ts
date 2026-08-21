import { expect, test } from "vitest";
import descriptor from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("empty config (pre-config instances) gets defaults applied", () => {
  expect(descriptor.configSchema.parse({})).toEqual({ format: "24h" });
});

test("valid IANA timezone accepted, garbage rejected", () => {
  expect(
    descriptor.configSchema.safeParse({ timeZone: "Europe/Helsinki", format: "12h" }).success,
  ).toBe(true);
  expect(
    descriptor.configSchema.safeParse({ timeZone: "Mars/Olympus", format: "24h" }).success,
  ).toBe(false);
});

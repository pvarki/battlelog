import { expect, test } from "vitest";
import { registry, validateWidgetConfig } from "./registry.ts";

test("registry discovers widgets with unique, self-consistent descriptors", () => {
  expect(registry.size).toBeGreaterThan(0);
  for (const [type, descriptor] of registry) {
    expect(descriptor.type).toBe(type);
    expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
    expect(descriptor.minSize.w).toBeLessThanOrEqual(descriptor.defaultSize.w);
    expect(descriptor.minSize.h).toBeLessThanOrEqual(descriptor.defaultSize.h);
  }
});

test("validateWidgetConfig flags unknown types and invalid configs", () => {
  expect(validateWidgetConfig("no-such-widget", {})).toEqual({
    ok: false,
    reason: "unknown-type",
  });
  const bad = validateWidgetConfig("clock", { format: "sundial" });
  expect(bad.ok).toBe(false);
  const good = validateWidgetConfig("clock", {});
  expect(good).toEqual({ ok: true, value: { format: "24h" } });
});

import { expect, test } from "vitest";
import descriptor from "./widget.ts";

const tab = (type: string) => ({ id: crypto.randomUUID(), type, config: {} });

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("tabs cannot nest tabs", () => {
  expect(descriptor.configSchema.safeParse({ tabs: [tab("note")] }).success).toBe(true);
  expect(descriptor.configSchema.safeParse({ tabs: [tab("tabs")] }).success).toBe(false);
});

test("tab count is capped", () => {
  const tabs = Array.from({ length: 9 }, () => tab("clock"));
  expect(descriptor.configSchema.safeParse({ tabs }).success).toBe(false);
});

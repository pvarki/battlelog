import { expect, test } from "vitest";
import descriptor, { withFreshTabIds } from "./widget.ts";

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

test("withFreshTabIds gives children new ids and keeps their config", () => {
  const original = { title: "Ops", tabs: [{ id: "a", type: "note", config: { eventId: "e1" } }] };
  const copy = withFreshTabIds(original) as typeof original;
  expect(copy.title).toBe("Ops");
  expect(copy.tabs[0]?.id).not.toBe("a");
  expect(copy.tabs[0]?.config).toEqual({ eventId: "e1" });
  expect(original.tabs[0]?.id).toBe("a");
});

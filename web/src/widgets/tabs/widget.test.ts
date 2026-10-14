import { expect, test } from "vitest";
import { mapChildWidgets } from "../../dashboard/registry.ts";
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

test("mapChildWidgets rewrites tabs in place and keeps the rest of the config", () => {
  const original = { title: "Ops", tabs: [{ id: "a", type: "note", config: { eventId: "e1" } }] };
  const copy = mapChildWidgets({ id: "t", type: "tabs", config: original }, (child) => ({
    ...child,
    id: crypto.randomUUID(),
  })) as typeof original;
  expect(copy.title).toBe("Ops");
  expect(copy.tabs[0]?.id).not.toBe("a");
  expect(copy.tabs[0]?.config).toEqual({ eventId: "e1" });
  expect(original.tabs[0]?.id).toBe("a");
});

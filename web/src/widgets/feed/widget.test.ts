import { expect, test } from "vitest";
import descriptor, { columnWidth, labelFor } from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("following the map selection is a valid option", () => {
  const config = { ...descriptor.defaultConfig, followTakSelection: true };
  expect(descriptor.configSchema.parse(config).followTakSelection).toBe(true);
});

test("schema migrates legacy string columns to column objects", () => {
  const parsed = descriptor.configSchema.safeParse({ columns: ["time", "header"] });
  expect(parsed.success && parsed.data.columns).toEqual([
    { id: "time", label: "", source: "time", dataPath: "" },
    { id: "header", label: "", source: "header", dataPath: "" },
  ]);
});

test("schema applies defaults and rejects bad columns", () => {
  const parsed = descriptor.configSchema.safeParse({});
  expect(parsed.success && parsed.data.rows).toBe(10);
  expect(parsed.success && parsed.data.columns.map((c) => c.source)).toEqual([
    "time",
    "header",
    "type",
  ]);
  expect(descriptor.configSchema.safeParse({ columns: [] }).success).toBe(false);
  expect(descriptor.configSchema.safeParse({ columns: ["location"] }).success).toBe(false);
});

test("schema accepts bounded column widths", () => {
  expect(
    descriptor.configSchema.safeParse({
      columns: [{ id: "header", label: "", source: "header", dataPath: "", width: 240 }],
    }).success,
  ).toBe(true);
  expect(
    descriptor.configSchema.safeParse({
      columns: [{ id: "header", label: "", source: "header", dataPath: "", width: 20 }],
    }).success,
  ).toBe(false);
});

test("columnWidth defaults to the header text or the field's usual content, until overridden", () => {
  expect(columnWidth({ id: "time", label: "", source: "time", dataPath: "" })).toBe(104);
  expect(columnWidth({ id: "header", label: "", source: "header", dataPath: "" })).toBe(160);
  expect(columnWidth({ id: "desk", label: "Desk", source: "data", dataPath: "desk" })).toBe(72);
  expect(
    columnWidth({
      id: "event-time",
      label: "Tapahtuma-ajankohta",
      source: "data",
      dataPath: "time",
    }),
  ).toBe(184);
  expect(columnWidth({ id: "header", label: "", source: "header", dataPath: "", width: 260 })).toBe(
    260,
  );
});

test("labelFor prefers explicit label, then field label, then data path tail", () => {
  expect(labelFor({ id: "1", label: "Custom", source: "time", dataPath: "" })).toBe("Custom");
  expect(labelFor({ id: "2", label: "", source: "time", dataPath: "" })).toBe("Time");
  expect(labelFor({ id: "3", label: "", source: "data", dataPath: "casualties.total" })).toBe(
    "total",
  );
  expect(labelFor({ id: "4", label: "", source: "data", dataPath: "" })).toBe("Data");
});

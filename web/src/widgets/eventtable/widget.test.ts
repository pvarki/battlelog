import { expect, test } from "vitest";
import descriptor from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("following the map selection is a valid option", () => {
  const config = { ...descriptor.defaultConfig, followTakSelection: true };
  expect(descriptor.configSchema.parse(config).followTakSelection).toBe(true);
});

test("a typed table config validates and fills column defaults", () => {
  const parsed = descriptor.configSchema.parse({
    types: "drone",
    columns: [
      { id: "s", field: "status", kind: "choice", options: [{ value: "ready", color: "green" }] },
      { id: "t", source: "time" },
    ],
  });
  expect(parsed.columns[0]).toMatchObject({ source: "data", editable: false, label: "" });
  expect(parsed.columns[1]?.kind).toBe("text");
  expect(parsed.sortBy).toBe("header");
});

import { expect, test } from "vitest";
import descriptor from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("a full status board config validates", () => {
  const config = {
    title: "Squad",
    statuses: [
      {
        id: "r1",
        label: "Pena",
        description: "Jääkäri Penttilä, 1. ryhmä",
        kind: "choice",
        options: [
          { value: "kusella", color: "yellow" },
          { value: "röökillä", color: "red", description: "Tupakkapaikalla, palaa 5 min" },
        ],
      },
      { id: "r2", label: "Rounds fired", kind: "count", options: [] },
    ],
  };
  expect(descriptor.configSchema.safeParse(config).success).toBe(true);
});

test("bad option color and empty labels are rejected", () => {
  expect(
    descriptor.configSchema.safeParse({
      statuses: [
        { id: "r1", label: "x", kind: "choice", options: [{ value: "a", color: "magenta" }] },
      ],
    }).success,
  ).toBe(false);
  expect(
    descriptor.configSchema.safeParse({
      statuses: [{ id: "r1", label: "", kind: "choice", options: [] }],
    }).success,
  ).toBe(false);
});

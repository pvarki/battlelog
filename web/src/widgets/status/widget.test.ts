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

test("rows keep working without a source, and bound rows validate", () => {
  const parsed = descriptor.configSchema.parse({
    statuses: [
      { id: "r1", label: "Local", kind: "choice", options: [] },
      {
        id: "r2",
        label: "Drone 1",
        kind: "text",
        source: { eventId: "6f1c0a52-5c1e-4c1b-9a6e-0d6f2f6a1b11", field: "status" },
      },
    ],
  });
  expect(parsed.statuses[0]?.source).toBeUndefined();
  expect(parsed.statuses[0]?.editable).toBe(false);
  expect(parsed.statuses[1]?.source?.field).toBe("status");
});

test("a dynamic group row validates and defaults its filters", () => {
  const parsed = descriptor.configSchema.parse({
    statuses: [{ id: "g1", label: "Drones", kind: "choice", group: { types: "drone" } }],
  });
  expect(parsed.statuses[0]?.group).toEqual({
    types: "drone",
    tags: "",
    dataFilters: [],
    field: "",
    layout: "list",
    labelField: "",
    properties: [],
  });
});

test("a sections group validates with properties", () => {
  const parsed = descriptor.configSchema.parse({
    statuses: [
      {
        id: "g",
        label: "Drones",
        group: {
          types: "drone",
          layout: "sections",
          labelField: "callsign",
          properties: [
            { id: "p1", field: "status", kind: "choice", options: [{ value: "ready" }] },
          ],
        },
      },
    ],
  });
  const property = parsed.statuses[0]?.group?.properties[0];
  expect(property).toMatchObject({ label: "", editable: false, kind: "choice" });
});

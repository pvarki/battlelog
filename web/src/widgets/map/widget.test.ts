import { expect, test } from "vitest";
import descriptor from "./widget.ts";

const parses = (config: unknown) => descriptor.configSchema.safeParse(config).success;

test("defaultConfig validates against configSchema", () => {
  expect(parses(descriptor.defaultConfig)).toBe(true);
});

test("empty config gets the default tools, a normal display and no pinned view", () => {
  expect(descriptor.configSchema.parse({})).toEqual({
    tools: ["layers", "search"],
    display: "normal",
    missions: [],
  });
});

test("a config saved before wall display still validates", () => {
  expect(parses({ tools: ["items"], view: { center: [22.3, 60.4], zoom: 12, bearing: 30 } })).toBe(
    true,
  );
});

test("unknown tools and out-of-range views are rejected", () => {
  expect(parses({ tools: ["teleport"] })).toBe(false);
  expect(parses({ view: { center: [22, 95], zoom: 10, bearing: 0 } })).toBe(false);
  expect(parses({ view: { center: [22.3, 60.4], zoom: 12, bearing: 30 } })).toBe(true);
});

test("a wall map following users, a mission and groups validates", () => {
  expect(
    parses({
      display: "wall",
      basemap: "orthophoto",
      groups: ["markers/team", "shapes"],
      missions: ["Op North"],
      follow: { callsigns: ["Alpha"], mission: "Op North", groups: ["markers/friendly/troops"] },
    }),
  ).toBe(true);
});

test("unknown displays, overlay groups and follow keys are rejected", () => {
  expect(parses({ display: "kiosk" })).toBe(false);
  expect(parses({ groups: ["markers/aliens"] })).toBe(false);
  expect(parses({ groups: ["toString"] })).toBe(false);
  expect(parses({ follow: { groups: ["nope"] } })).toBe(false);
  expect(parses({ follow: { uids: ["x"] } })).toBe(false);
});

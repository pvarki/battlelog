import { expect, test } from "vitest";
import descriptor, { effectiveMap, type MapConfig } from "./widget.ts";

const parse = (config: unknown) => descriptor.configSchema.safeParse(config);
const parses = (config: unknown) => parse(config).success;

test("defaultConfig validates against configSchema", () => {
  expect(parses(descriptor.defaultConfig)).toBe(true);
});

test("an empty config is a normal view with the default controls", () => {
  const config = descriptor.configSchema.parse({}) as MapConfig;
  expect(config).toEqual({ display: "normal", missions: [] });
  const effective = effectiveMap(config);
  expect([...effective.controls]).toEqual(["search", "layers", "zoom", "status", "openInMap"]);
  expect(effective).toMatchObject({
    select: true,
    panZoom: true,
    answerPicks: true,
    symbolScale: 1,
  });
});

test("the wall preset changes the defaults, and explicit settings win over it", () => {
  const wall = effectiveMap(descriptor.configSchema.parse({ display: "wall" }) as MapConfig);
  expect([...wall.controls]).toEqual(["status"]);
  expect(wall).toMatchObject({
    select: false,
    panZoom: false,
    answerPicks: false,
    symbolScale: 1.5,
  });
  const tuned = effectiveMap(
    descriptor.configSchema.parse({ display: "wall", select: true, controls: [] }) as MapConfig,
  );
  expect(tuned.select).toBe(true);
  expect(tuned.controls.size).toBe(0);
});

test("a widget saved with tools keeps its search and layers as controls", () => {
  const result = parse({ tools: ["items", "search", "draw"], display: "normal", missions: [] });
  expect(result.success && result.data).toEqual({
    display: "normal",
    missions: [],
    controls: ["search", "zoom", "status", "openInMap"],
  });
});

test("a wall saved with tools keeps the wall's controls", () => {
  const result = parse({ tools: [], display: "wall", missions: [] });
  expect(result.success && result.data).toEqual({ display: "wall", missions: [] });
});

test("a full configuration validates", () => {
  expect(
    parses({
      display: "wall",
      basemap: "orthophoto",
      overlay: { source: "topographic", opacity: 0.4 },
      dim: true,
      mgrsGrid: false,
      tracks: true,
      groups: ["markers/team", "shapes"],
      missions: ["Op North"],
      follow: { callsigns: ["Alpha"], mission: "Op North", groups: ["markers/friendly/troops"] },
      view: { center: [22.3, 60.4], zoom: 12, bearing: 30 },
      symbolScale: 2,
      controls: ["status"],
      panZoom: false,
      select: true,
      cardActions: ["centre"],
      shareSelection: false,
      centreOnSelection: false,
      answerPicks: false,
    }),
  ).toBe(true);
});

test("unknown values are rejected", () => {
  expect(parses({ display: "kiosk" })).toBe(false);
  expect(parses({ groups: ["markers/aliens"] })).toBe(false);
  expect(parses({ groups: ["toString"] })).toBe(false);
  expect(parses({ follow: { uids: ["x"] } })).toBe(false);
  expect(parses({ controls: ["teleport"] })).toBe(false);
  expect(parses({ cardActions: ["delete"] })).toBe(false);
  expect(parses({ overlay: { source: "osm", opacity: 0, extra: 1 } })).toBe(false);
  expect(parses({ view: { center: [22, 95], zoom: 10, bearing: 0 } })).toBe(false);
});

// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, type Position, type TakItem, toChange } from "../cot.ts";
import { placementFor, renderGraphic } from "../map/tactical.ts";
import {
  controlPoints,
  newTacticalGraphicEvent,
  pointsProblem,
  TACTICAL_GRAPHICS,
  type TacticalGraphic,
} from "./tactical-graphics.ts";

const R = await import("@armyc2.c5isr.renderer/mil-sym-ts-web");

const sender = { uid: "BattleLog-Eversti", callsign: "Eversti" };
const look = { name: "ALFA", affiliation: "friendly" as const, remarks: "" };
const byName = (name: string) => {
  const found = TACTICAL_GRAPHICS.find((g) => g.name === name);
  if (!found) throw new Error(name);
  return found;
};
const parsed = (event: CotEvent): TakItem => {
  const change = toChange(event);
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  return change.item;
};
const clicks = (g: TacticalGraphic): Position[] =>
  [
    [22.2, 60.44],
    [22.25, 60.45],
    [22.3, 60.43],
    [22.24, 60.42],
  ].slice(0, g.points?.min ?? (g.shape === "line" ? 2 : 3)) as Position[];

test("every graphic is a 2525C code ATAK writes, in the shape the renderer draws it on", () => {
  const msl = R.MSLookup.getInstance();
  for (const g of TACTICAL_GRAPHICS) {
    expect(g.sidc).toMatch(/^G\*[GMFS]\*[A-Z-]{6}\*{4}X$/);
    const code = R.C2DLookup.getInstance().getDCode(g.sidc.replaceAll("*", "-"));
    expect(code, g.name).toBeTruthy();
    const info = msl.getMSLInfo(code);
    expect(info.getGeometry(), g.name).toBe(g.shape === "line" ? "Line" : "Area");
    for (let count = 1; count <= 8; count++) {
      const fits = count >= info.getMinPointCount() && count <= info.getMaxPointCount();
      expect(pointsProblem(g, count) === undefined, `${g.name}, ${count} points`).toBe(fits);
    }
  }
});

test("every graphic, drawn with the fewest clicks, renders back from its CoT", () => {
  for (const g of TACTICAL_GRAPHICS) {
    const item = parsed(newTacticalGraphicEvent(g, clicks(g), look, sender));
    expect(renderGraphic(R, item)?.length, g.name).toBeGreaterThan(0);
  }
});

test("a phase line goes out as ATAK's u-d-f line with its code, name and side's colour", () => {
  const event = newTacticalGraphicEvent(
    byName("Phase line"),
    [
      [22, 60],
      [22.1, 60.1],
    ],
    { ...look, affiliation: "hostile" },
    sender,
    1_000,
    "tg1",
  );
  expect(event).toMatchObject({ uid: "tg1", type: "u-d-f" });
  expect(event.detail).toContain('<__milsym id="G*G*GLP---****X"/>');
  expect(event.detail).toContain('<link point="60,22"/><link point="60.1,22.1"/>');
  expect(parsed(event)).toMatchObject({
    callsign: "ALFA",
    sidc: "G-G-GLP-------X",
    labelsOn: true,
    stroke: { color: "#ff0000" },
    geometry: { type: "LineString" },
  });
});

test("areas close like ATAK's, with no fill under the graphic; obstacles stay green", () => {
  const item = parsed(
    newTacticalGraphicEvent(byName("Mined area"), clicks(byName("Mined area")), look, sender),
  );
  expect(item.geometry.type).toBe("Polygon");
  expect(item.fill?.opacity).toBe(0);
  expect(item.stroke?.color).toBe("#00ff00");
  expect(item.event.detail.match(/<link point/g)).toHaveLength(4);
});

test("arrows go out tip first, whatever order they were clicked in", () => {
  const [a, b, c, d] = clicks({ shape: "area", points: { min: 4, max: 4 } } as TacticalGraphic) as [
    Position,
    Position,
    Position,
    Position,
  ];
  expect(controlPoints(byName("Direction of attack, main attack"), [a, b, c])).toEqual([c, b, a]);
  // Start, bend, tip, then the width point beside the arrowhead.
  expect(controlPoints(byName("Axis of advance, main attack"), [a, b, c, d])).toEqual([c, b, a, d]);
  expect(controlPoints(byName("Attack by fire position"), [a, b, c])).toEqual([c, a, b]);
  expect(controlPoints(byName("Support by fire position"), [a, b, c, d])).toEqual([a, b, c, d]);
  expect(controlPoints(byName("Boundary"), [a, b, c])).toEqual([a, b, c]);
});

test("the axis of advance's arrowhead lands on the last clicked axis point", () => {
  const axis = byName("Axis of advance, main attack");
  const tip: Position = [22.1, 60];
  const event = newTacticalGraphicEvent(axis, [[22, 60], tip, [22.098, 60.002]], look, sender);
  const item = parsed(event);
  if (item.geometry.type !== "LineString") throw new Error("expected a line");
  expect(placementFor(R, axis.sidc, item.geometry)?.points[0]).toEqual(tip);
});

test("graphics that need a set number of points say so", () => {
  expect(pointsProblem(byName("Attack by fire position"), 4)).toBe("Needs exactly 3 points");
  expect(pointsProblem(byName("Axis of advance, main attack"), 2)).toBe("Needs at least 3 points");
  expect(pointsProblem(byName("Objective"), 2)).toBe("Needs at least 3 points");
  expect(pointsProblem(byName("Boundary"), 7)).toBeUndefined();
});

// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, type TakItem, toChange } from "../cot.ts";
import { centreOfItems, movedEvent, offsetBetween } from "./move-items.ts";

const base: Omit<CotEvent, "type" | "detail"> = {
  uid: "x",
  how: "h-e",
  time: 1_000,
  start: 1_000,
  stale: 2_000,
  lat: 60,
  lon: 22,
  hae: 12,
  ce: 9999999,
  le: 9999999,
};

const item = (type: string, detail: string, event: Partial<CotEvent> = {}): TakItem => {
  const change = toChange({ ...base, type, detail, ...event });
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  return change.item;
};

const pointsOf = (event: CotEvent) =>
  [...event.detail.matchAll(/point="([^"]+)"/g)].map((m) => m[1]);

test("a moved marker shifts its point, drops the old spot's altitude and keeps its detail", () => {
  const marker = item("a-h-G", '<contact callsign="V1"/><plugin x="1"/>');
  const moved = movedEvent(marker, [0.5, -0.25], 5_000);
  expect(moved).toMatchObject({ lon: 22.5, lat: 59.75, hae: 9999999, time: 5_000 });
  expect(moved.detail).toBe(marker.event.detail);
});

test("a shape moves every vertex and its centre; a circle keeps its radius", () => {
  const square =
    '<link point="60,22"/><link point="60,23"/><link point="61,23"/><link point="61,22"/><link point="60,22"/>';
  const moved = movedEvent(item("u-d-f", square), [1, 2]);
  expect(pointsOf(moved)).toEqual(["62,23", "62,24", "63,24", "63,23", "62,23"]);
  expect(moved).toMatchObject({ lon: 23, lat: 62 });

  const circle = item("u-d-c-c", '<shape><ellipse major="500" minor="500" angle="0"/></shape>');
  const movedCircle = movedEvent(circle, [1, 1]);
  expect(movedCircle).toMatchObject({ lon: 23, lat: 61 });
  expect(movedCircle.detail).toBe(circle.event.detail);
});

test("a route moves its checkpoints, keeping their names, uids and altitudes, but not its 0,0 point", () => {
  const route = item(
    "b-m-r",
    '<link uid="a" callsign="SP" type="b-m-p-w" point="60,22,5" relation="c"/>' +
      '<link uid="b" callsign="VDO" type="b-m-p-w" point="60.5,22.5" relation="c"/>' +
      '<link uid="me" relation="p-p" type="a-f-G-U-C"/>',
    { lat: 0, lon: 0 },
  );
  const moved = movedEvent(route, [1, 1]);
  expect(pointsOf(moved)).toEqual(["61,23,5", "61.5,23.5"]);
  expect(moved.detail).toContain('uid="b" callsign="VDO"');
  expect(moved.detail).toContain('<link uid="me" relation="p-p"');
  expect(moved).toMatchObject({ lon: 0, lat: 0 });
});

test("a group moves so that the middle of its anchors lands on the target", () => {
  const items = [item("a-h-G", ""), item("a-h-G", "", { lon: 24, lat: 62 })];
  expect(centreOfItems(items)).toEqual([23, 61]);
  expect(offsetBetween(centreOfItems(items), [25, 60])).toEqual([2, -1]);
});

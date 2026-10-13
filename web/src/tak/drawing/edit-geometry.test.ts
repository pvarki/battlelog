// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, type TakItem, toChange } from "../cot.ts";
import { editGeometryEvent, editTarget } from "./edit-geometry.ts";

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

const routeDetail =
  '<link uid="a" callsign="SP" type="b-m-p-w" point="60,22,5" remarks="" relation="c"/>' +
  '<link uid="b" callsign="CP1" type="b-m-p-w" point="60.1,22.1" remarks="" relation="c"/>' +
  '<link uid="c" callsign="VDO" type="b-m-p-w" point="60.2,22.2" remarks="" relation="c"/>' +
  '<link_attr color="-1"/><contact callsign="Reitti"/><__routeinfo><__navcues/></__routeinfo>';

test("a moved marker keeps its detail and loses an altitude that was for the old spot", () => {
  const marker = item("a-h-G", '<contact callsign="V1"/><plugin x="1"/>');
  expect(editTarget(marker)?.tool).toBe("marker");
  const moved = editGeometryEvent(marker, { kind: "marker", position: [22.5, 60.5] }, 5_000);
  expect(moved).toMatchObject({ lat: 60.5, lon: 22.5, hae: 9999999, time: 5_000 });
  expect(moved.detail).toBe(marker.event.detail);
});

test("route checkpoints keep name and uid when moved; inserted points are control points", () => {
  const route = item("b-m-r", routeDetail, { lat: 0, lon: 0 });
  expect(editTarget(route)?.tool).toBe("route");
  const edited = editGeometryEvent(route, {
    kind: "route",
    points: [
      [22, 60],
      [22.05, 60.05],
      [22.15, 60.12],
      [22.2, 60.2],
    ],
  });
  expect(edited).toMatchObject({ lat: 0, lon: 0 });
  const links = edited.detail.match(/<link [^>]*>/g) ?? [];
  expect(links[0]).toBe(
    '<link uid="a" callsign="SP" type="b-m-p-w" point="60,22,5" remarks="" relation="c"/>',
  );
  expect(links[1]).toMatch(
    /callsign="" type="b-m-p-c" point="60.05,22.05" remarks="" relation="c"/,
  );
  expect(links[2]).toBe(
    '<link uid="b" callsign="CP1" type="b-m-p-w" point="60.12,22.15" remarks="" relation="c"/>',
  );
  expect(links[3]).toContain('uid="c"');
  expect(edited.detail).toContain('<link_attr color="-1"/><contact callsign="Reitti"/>');
});

test("removing a route point drops its link and nothing else", () => {
  const route = item("b-m-r", routeDetail);
  const edited = editGeometryEvent(route, {
    kind: "route",
    points: [
      [22, 60],
      [22.2, 60.2],
    ],
  });
  expect(edited.detail.match(/uid="(\w)"/g)).toEqual(['uid="a"', 'uid="c"']);
});

test("a reshaped polygon stays closed the ATAK way, centred on its corners", () => {
  const polygon = item(
    "u-d-f",
    '<link point="60,22"/><link point="60,23"/><link point="61,23"/><link point="60,22"/><strokeColor value="-1"/>',
  );
  expect(editTarget(polygon)?.tool).toBe("polygon");
  const edited = editGeometryEvent(polygon, {
    kind: "polygon",
    points: [
      [22, 60],
      [24, 60],
      [24, 62],
      [22, 62],
    ],
  });
  expect(edited.detail).toBe(
    '<link point="60,22"/><link point="60,24"/><link point="62,24"/><link point="62,22"/><link point="60,22"/><strokeColor value="-1"/>',
  );
  expect(edited).toMatchObject({ lat: 61, lon: 23 });
});

test("a circle's new size goes into its ellipse; an ellipse only moves", () => {
  const shape = (minor: number) =>
    item(
      "u-d-c-c",
      `<shape><ellipse major="100" minor="${minor}" angle="360"/></shape><contact callsign="C"/>`,
    );
  const drawn = { kind: "circle" as const, centre: [22.1, 60.1] as [number, number], radius: 250 };
  const circle = editGeometryEvent(shape(100), drawn);
  expect(circle.detail).toContain('<ellipse major="250" minor="250" angle="360"/>');
  expect(circle).toMatchObject({ lat: 60.1, lon: 22.1 });
  expect(editGeometryEvent(shape(50), drawn).detail).toContain('major="100" minor="50"');
  const target = editTarget(shape(100));
  expect(target?.tool).toBe("circle");
  expect(target?.geometry.type).toBe("Polygon");
});

test("TAK users' own positions and derived drawings can't be reshaped", () => {
  expect(
    editTarget(item("a-f-G-U-C", '<__group name="Cyan" role="Team Member"/>')),
  ).toBeUndefined();
  expect(editTarget(item("u-rb-a", '<range value="100"/><bearing value="90"/>'))).toBeUndefined();
});

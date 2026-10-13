// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, toChange } from "./cot.ts";

const base: CotEvent = {
  uid: "u1",
  type: "a-f-G-U-C",
  how: "m-g",
  time: 1000,
  start: 1000,
  stale: 2000,
  lat: 60,
  lon: 25,
  hae: 9999999,
  ce: 0,
  le: 0,
  detail: "",
};

test("a TAK user with team, device and track", () => {
  const change = toChange({
    ...base,
    detail:
      '<contact callsign="KETTU23a" endpoint="*:-1:stcp"/><__group name="Cyan" role="Team Member"/><status battery="81"/><takv platform="ATAK-CIV" version="5.8"/><track speed="1.5" course="90"/>',
  });
  expect(change?.kind).toBe("upsert");
  if (change?.kind !== "upsert") return;
  expect(change.item).toMatchObject({
    callsign: "KETTU23a",
    team: "Cyan",
    role: "Team Member",
    battery: 81,
    device: "ATAK-CIV 5.8",
    speed: 1.5,
    course: 90,
    geometry: { type: "Point", coordinates: [25, 60] },
  });
  expect(change.item.hae).toBeUndefined();
});

test("a placed marker keeps its symbol, creator and remarks", () => {
  const change = toChange({
    ...base,
    type: "a-h-G",
    detail:
      '<__milsym id="10061000001211000000"/><link uid="parent" relation="p-p" type="a-f-G-U-C" parent_callsign="SUSI11"/><remarks>Konekivääri</remarks>',
  });
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  expect(change.item).toMatchObject({
    sidc: "10061000001211000000",
    creator: "SUSI11",
    remarks: "Konekivääri",
  });
});

test("a closed shape becomes a polygon with its colours", () => {
  const change = toChange({
    ...base,
    type: "u-d-f",
    detail:
      '<link point="60,25"/><link point="60,26"/><link point="61,26"/><link point="60,25"/><strokeColor value="-65536"/><fillColor value="1442775040"/>',
  });
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  expect(change.item.geometry.type).toBe("Polygon");
  expect(change.item.stroke).toEqual({ color: "#ff0000", opacity: 1 });
  expect(change.item.fill?.opacity).toBeCloseTo(0.33, 2);
});

test("TAK's disconnect notice greys the contact; a forced delete removes it", () => {
  const link = '<link uid="u1" relation="p-p" type="a-f-G-U-C"/>';
  expect(toChange({ ...base, type: "t-x-d-d", detail: link })).toEqual({
    kind: "offline",
    uid: "u1",
    time: 1000,
  });
  expect(toChange({ ...base, type: "t-x-d-d", detail: `${link}<__forcedelete/>` })).toEqual({
    kind: "delete",
    uid: "u1",
    time: 1000,
  });
});

test("non-map events and broken detail are ignored", () => {
  expect(toChange({ ...base, type: "t-x-c-t" })).toBeNull();
  expect(toChange({ ...base, detail: "<contact" })).toBeNull();
});

test("an ellipse keeps both axes and its angle", () => {
  const change = toChange({
    ...base,
    type: "u-d-c-e",
    detail: '<shape><ellipse major="100" minor="20" angle="45"/></shape>',
  });
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  expect(change.item.ellipse).toEqual({ major: 100, minor: 20, angle: 45 });
});

test("an impossible timestamp is rejected, so it can't block the uid forever", () => {
  expect(toChange({ ...base, time: Number.POSITIVE_INFINITY })).toBeNull();
});

const upsert = (event: Partial<CotEvent>) => {
  const change = toChange({ ...base, ...event });
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  return change.item;
};

test("ATAK line style and label switch", () => {
  const item = upsert({
    type: "u-d-f",
    detail:
      '<link point="60,25"/><link point="60,26"/><strokeStyle value="dashed"/><labels_on value="true"/>',
  });
  expect(item).toMatchObject({ strokeStyle: "dashed", labelsOn: true });
  expect(upsert({ type: "u-d-f", detail: '<labels_on value="false"/>' }).labelsOn).toBe(false);
});

test("circles label their radius unless told not to", () => {
  const circle = '<shape><ellipse major="100" minor="100" angle="0"/></shape>';
  expect(upsert({ type: "u-d-c-c", detail: circle }).labelsOn).toBe(true);
  expect(upsert({ type: "u-d-c-c", detail: `${circle}<labels_on value="false"/>` }).labelsOn).toBe(
    false,
  );
});

test("two points that meet are a line, not a closed shape", () => {
  const item = upsert({ type: "u-d-f", detail: '<link point="60,25"/><link point="60,25"/>' });
  expect(item.geometry.type).toBe("LineString");
});

test("a route keeps its named waypoints and its link_attr colour", () => {
  const item = upsert({
    type: "b-m-r",
    detail:
      '<link type="b-m-p-w" callsign="Polku – start" point="60.1,25.1"/><link type="b-m-p-c" callsign="" point="60.2,25.2"/><link type="b-m-p-w" callsign="VDO" point="60.3,25.3"/><link_attr color="-16711936" stroke="4"/>',
  });
  expect(item.geometry.type).toBe("LineString");
  expect(item.waypoints).toEqual([
    { name: "Polku – start", position: [25.1, 60.1] },
    { name: "VDO", position: [25.3, 60.3] },
  ]);
  expect(item.stroke?.color).toBe("#00ff00");
  expect(item.strokeWidth).toBe(4);
});

test("a sensor point keeps its ground footprint; a collapsed one is dropped", () => {
  const vertex = (lat: number, lon: number) => `<vertex lat="${lat}" lon="${lon}" hae="0"/>`;
  const shape = (v: string) => `<shape><polyline closed="true">${v}</polyline></shape>`;
  const spread = upsert({
    type: "b-m-p-s-p-i",
    detail: shape(vertex(60, 25) + vertex(60, 25.1) + vertex(60.1, 25.1)),
  });
  expect(spread.footprint).toHaveLength(3);
  const collapsed = upsert({ type: "b-m-p-s-p-i", detail: shape(vertex(60, 25).repeat(4)) });
  expect(collapsed.footprint).toBeUndefined();
});

test("range and bearing runs from its point to the computed end", () => {
  const item = upsert({
    type: "u-rb-a",
    lat: 60,
    lon: 25,
    detail: '<range value="1000"/><bearing value="90"/><northRef value="0"/>',
  });
  expect(item.rangeBearing).toEqual({ range: 1000, bearing: 90, northRef: "T" });
  if (item.geometry.type !== "LineString") throw new Error("expected a line");
  const [, end] = item.geometry.coordinates;
  expect(end?.[1]).toBeCloseTo(60, 3);
  expect(end?.[0]).toBeGreaterThan(25.017);
  expect(end?.[0]).toBeLessThan(25.019);
});

test("an ATAK emergency names its kind and who raised it", () => {
  const change = toChange({
    ...base,
    uid: "ANDROID-1-9-1-1",
    type: "b-a-o-tbl",
    detail:
      '<link uid="ANDROID-1" type="a-f-G-U-C" relation="p-p"/><contact callsign="KETTU-Alert"/><emergency type="911 Alert">KETTU</emergency>',
  });
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  expect(change.item.emergency).toEqual({ kind: "911 Alert", from: "KETTU" });
});

test("an emergency without an <emergency> element is named after its type", () => {
  const change = toChange({ ...base, type: "b-a-o-opn", detail: '<contact callsign="KETTU"/>' });
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  expect(change.item.emergency).toEqual({ kind: "Troops In Contact", from: "KETTU" });
});

test("cancelling an emergency deletes its alert", () => {
  const cancel = { ...base, uid: "ANDROID-1-9-1-1", time: 5000 };
  expect(
    toChange({
      ...cancel,
      type: "b-a-o-can",
      detail: '<emergency cancel="true">KETTU</emergency>',
    }),
  ).toEqual({ kind: "delete", uid: "ANDROID-1-9-1-1", time: 5000 });
  expect(
    toChange({
      ...cancel,
      type: "b-a-o-tbl",
      detail: '<emergency cancel="true">KETTU</emergency>',
    }),
  ).toEqual({ kind: "delete", uid: "ANDROID-1-9-1-1", time: 5000 });
});

test("other items carry no emergency", () => {
  const change = toChange({ ...base, detail: '<contact callsign="KETTU"/>' });
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  expect(change.item.emergency).toBeUndefined();
});

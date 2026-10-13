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

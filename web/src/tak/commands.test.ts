// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { deleteEvent, editEvent, setCallsign, setRemarks } from "./commands.ts";
import { type CotEvent, toChange } from "./cot.ts";

const event: CotEvent = {
  uid: "hostile-1",
  type: "a-h-G",
  how: "h-g-i-g-o",
  time: 1_000,
  start: 1_000,
  stale: 1_000 + 86_400_000,
  lat: 60.4,
  lon: 22.2,
  hae: 9999999,
  ce: 9999999,
  le: 9999999,
  detail:
    '<contact callsign="Vihollinen 1"/><__milsym id="10061000001211000000"/><link uid="ANDROID-1" relation="p-p" type="a-f-G-U-C" parent_callsign="SUSI11"/><plugin_extension x="1"><nested a="b"/></plugin_extension>',
};

const item = () => {
  const change = toChange(event);
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  return change.item;
};

test("an edit changes only what it is about and keeps other clients' extensions", () => {
  const edited = editEvent(
    item(),
    (detail) => {
      setCallsign(detail, "Vihollinen 1 (tuhottu)");
      setRemarks(detail, "Tuhottu 13.10. & kuvattu");
    },
    5_000,
  );
  expect(edited.uid).toBe("hostile-1");
  expect(edited.type).toBe("a-h-G");
  expect(edited.detail).toContain('<contact callsign="Vihollinen 1 (tuhottu)"/>');
  expect(edited.detail).toContain("<remarks>Tuhottu 13.10. &amp; kuvattu</remarks>");
  expect(edited.detail).toContain('<__milsym id="10061000001211000000"/>');
  expect(edited.detail).toContain('parent_callsign="SUSI11"');
  expect(edited.detail).toContain('<plugin_extension x="1"><nested a="b"/></plugin_extension>');
});

test("an edit is re-issued now with ATAK's lifetimes: a year for markers, a day for shapes", () => {
  expect(editEvent(item(), () => {}, 5_000)).toMatchObject({
    time: 5_000,
    start: 5_000,
    stale: 5_000 + 365 * 86_400_000,
  });
  const shape = { ...item(), type: "u-d-f" };
  expect(editEvent(shape, () => {}, 5_000).stale).toBe(5_000 + 86_400_000);
});

test("a delete is ATAK's forced delete of the item, under its uid and markings", () => {
  const marked = { ...item(), event: { ...event, access: "Unclassified" } };
  const del = deleteEvent(marked, 5_000);
  expect(del).toMatchObject({
    uid: "hostile-1",
    type: "t-x-d-d",
    time: 5_000,
    lat: 0,
    lon: 0,
    access: "Unclassified",
  });
  expect(del.detail).toBe('<link uid="hostile-1" relation="none" type="a-h-G"/><__forcedelete/>');
  expect(toChange(del)).toEqual({ kind: "delete", uid: "hostile-1", time: 5_000 });
});

test("classification markings travel with the edit", () => {
  const marked = { ...item(), event: { ...event, access: "Unclassified", caveat: "FOUO" } };
  expect(editEvent(marked, () => {}, 5_000)).toMatchObject({
    access: "Unclassified",
    caveat: "FOUO",
  });
});

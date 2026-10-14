// @vitest-environment happy-dom
import { expect, test } from "vitest";
import type { CotEvent } from "./cot-event.ts";
import { cotXmlPieces, parseCotXml } from "./cot-xml.ts";
import { decodeTakMessages, encodeTakMessage } from "./takproto.ts";

const marker: CotEvent = {
  uid: "marker-1",
  type: "a-h-G",
  how: "h-g-i-g-o",
  time: Date.parse("2026-10-13T10:00:00Z"),
  start: Date.parse("2026-10-13T10:00:00Z"),
  stale: Date.parse("2026-10-14T10:00:00Z"),
  lat: 60.17,
  lon: 24.94,
  hae: 9999999,
  ce: 9999999,
  le: 9999999,
  detail:
    '<contact callsign="Vihollinen 1"/><__milsym id="SHGPUCI--------"/><remarks>Ryhmä &amp; ajoneuvo</remarks>',
};

test("an encoded event decodes back unchanged", () => {
  const { events, error } = decodeTakMessages(encodeTakMessage(marker));
  expect(error).toBeUndefined();
  expect(events).toEqual([marker]);
});

test("several messages in one frame all decode", () => {
  const one = encodeTakMessage(marker);
  const two = encodeTakMessage({ ...marker, uid: "marker-2" });
  const { events } = decodeTakMessages(Uint8Array.from([...one, ...two]));
  expect(events.map((e) => e.uid)).toEqual(["marker-1", "marker-2"]);
});

test("a truncated message keeps the events decoded before it", () => {
  const one = encodeTakMessage(marker);
  const { events, error } = decodeTakMessages(Uint8Array.from([...one, ...one.slice(0, 10)]));
  expect(events).toHaveLength(1);
  expect(error).toBeInstanceOf(Error);
});

test("archive XML with several events and declarations", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><event version="2.0" uid="a" type="a-f-G" how="m-g" time="2026-10-13T10:00:00Z" start="2026-10-13T10:00:00Z" stale="2026-10-13T10:05:00Z"><point lat="60.1" lon="24.9" hae="10" ce="5" le="5"/><detail><contact callsign="KETTU23a"/><custom x="1"><nested/></custom></detail></event><?xml version="1.0"?><event version="2.0" uid="b" type="b-m-p-s-m" how="h-g-i-g-o" time="2026-10-13T11:00:00Z" start="2026-10-13T11:00:00Z" stale="2026-10-14T11:00:00Z"><point lat="61" lon="25" hae="0" ce="0" le="0"/><detail/></event>`;
  const events = parseCotXml(xml);
  expect(events.map((e) => e.uid)).toEqual(["a", "b"]);
  expect(events[0]?.lat).toBe(60.1);
  expect(events[0]?.time).toBe(Date.parse("2026-10-13T10:00:00Z"));
  expect(events[0]?.detail).toBe('<contact callsign="KETTU23a"/><custom x="1"><nested/></custom>');
});

test("an archive cut into pieces parses to the same events, wrapper and declarations dropped", () => {
  const event = (uid: string) =>
    `<event version="2.0" uid="${uid}" type="a-f-G" how="m-g" time="2026-10-13T10:00:00Z" start="2026-10-13T10:00:00Z" stale="2026-10-13T10:05:00Z"><point lat="60" lon="25" hae="0" ce="0" le="0"/><detail><remarks>&lt;/event&gt; is text</remarks></detail></event>`;
  const xml = `<?xml version="1.0"?><events>${["a", "b", "c", "d", "e"].map(event).join("")}</events>`;
  const pieces = cotXmlPieces(xml, 2);
  expect(pieces).toHaveLength(3);
  const events = pieces.flatMap((piece) => parseCotXml(piece, { strict: true }));
  expect(events).toEqual(parseCotXml(xml, { strict: true }));
  expect(events.map((e) => e.uid)).toEqual(["a", "b", "c", "d", "e"]);
  expect(cotXmlPieces("<events/>", 2)).toEqual([]);
});

test("malformed XML yields no events", () => {
  expect(parseCotXml("<event uid=")).toEqual([]);
  expect(parseCotXml("")).toEqual([]);
});

test("an overlong varint is an error, not Infinity", () => {
  const bad = Uint8Array.from([0xbf, ...new Array(11).fill(0xff), 0x01]);
  const { events, error } = decodeTakMessages(bad);
  expect(events).toEqual([]);
  expect(error).toBeInstanceOf(Error);
});

test("archive XML wrapped in TAK's own <events> root", () => {
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?><events><event version='2.0' uid='x' type='b-m-p-s-m' time='2026-10-13T16:28:36.873Z' start='2026-10-13T16:28:36.873Z' stale='2026-10-13T16:38:36.746Z' how='h-g-i-g-o'><point lat='64.0' lon='25.5' hae='9999999' ce='9999999.0' le='9999999.0' /><detail><contact callsign="Eversti test"/></detail></event></events>`;
  expect(parseCotXml(xml).map((e) => e.uid)).toEqual(["x"]);
});

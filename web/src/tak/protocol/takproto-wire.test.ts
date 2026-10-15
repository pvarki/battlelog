import { expect, test } from "vitest";
import { decodeTakMessages } from "./takproto.ts";

/*
 * Wire fixtures assembled by hand, independent of takproto.ts's encoder (which
 * only ever writes detail as xmlDetail). Field numbers are from TAK's published
 * takproto .proto files: takmessage, cotevent, detail, contact, group,
 * precisionlocation, status, takv, track.
 */

const varint = (value: number): number[] => {
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};
const tag = (field: number, wireType: number) => varint(field * 8 + wireType);
const u64 = (field: number, value: number) => [...tag(field, 0), ...varint(value)];
const f64 = (field: number, value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return [...tag(field, 1), ...bytes];
};
const msg = (field: number, ...parts: number[][]) => {
  const body = parts.flat();
  return [...tag(field, 2), ...varint(body.length), ...body];
};
const str = (field: number, value: string) => msg(field, [...new TextEncoder().encode(value)]);
const frame = (...takMessage: number[][]) => {
  const body = takMessage.flat();
  return [0xbf, ...varint(body.length), ...body];
};

const sent = Date.parse("2026-10-13T10:00:00Z");
const stale = Date.parse("2026-10-13T10:02:00Z");

const atakPositionReport = frame(
  msg(
    2, // TakMessage.cotEvent
    str(1, "a-f-G-U-C"), // type
    str(2, "Unclassified"), // access
    str(3, "1-r-c"), // qos
    str(4, "e-exercise"), // opex
    str(5, "ANDROID-kettu23"), // uid
    u64(6, sent), // sendTime
    u64(7, sent), // startTime
    u64(8, stale), // staleTime
    str(9, "m-g"), // how
    f64(10, 60.1699), // lat
    f64(11, -24.9384), // lon
    f64(12, 21.5), // hae
    f64(13, 4.9), // ce
    f64(14, 9999999), // le
    msg(
      15, // detail
      msg(2, str(1, "*:-1:stcp"), str(2, 'KETTU 2&3 "a"')), // contact: endpoint, callsign
      msg(3, str(1, "Cyan"), str(2, "Team Lead")), // group (__group): name, role
      msg(4, str(1, "GPS"), str(2, "DTED0")), // precisionLocation: geopointsrc, altsrc
      msg(5, u64(1, 87)), // status: battery
      msg(6, str(1, "Pixel 7"), str(2, "ATAK-CIV"), str(3, "34"), str(4, "5.1.0.6")), // takv: device, platform, os, version
      msg(7, f64(1, 1.25), f64(2, 271.5)), // track: speed, course
    ),
    str(16, "FOUO"), // caveat
    str(17, "FIN"), // releaseableTo
  ),
  u64(3, sent + 5), // TakMessage.submissionTime, unknown to the decoder
  u64(4, sent + 7), // TakMessage.creationTime, unknown to the decoder
);

test("the fixture helpers produce protobuf's documented bytes", () => {
  expect(varint(300)).toEqual([0xac, 0x02]);
  expect(u64(1, 150)).toEqual([0x08, 0x96, 0x01]);
  expect(str(2, "testing")).toEqual([0x12, 0x07, 0x74, 0x65, 0x73, 0x74, 0x69, 0x6e, 0x67]);
});

test("an ATAK position report with every structured detail field decodes to CoT", () => {
  const { events, error } = decodeTakMessages(Uint8Array.from(atakPositionReport));
  expect(error).toBeUndefined();
  expect(events).toEqual([
    {
      type: "a-f-G-U-C",
      access: "Unclassified",
      qos: "1-r-c",
      opex: "e-exercise",
      uid: "ANDROID-kettu23",
      time: sent,
      start: sent,
      stale,
      how: "m-g",
      lat: 60.1699,
      lon: -24.9384,
      hae: 21.5,
      ce: 4.9,
      le: 9999999,
      caveat: "FOUO",
      releasableTo: "FIN",
      detail:
        '<contact endpoint="*:-1:stcp" callsign="KETTU 2&amp;3 &quot;a&quot;"/>' +
        '<__group name="Cyan" role="Team Lead"/>' +
        '<precisionlocation geopointsrc="GPS" altsrc="DTED0"/>' +
        '<status battery="87"/>' +
        '<takv device="Pixel 7" platform="ATAK-CIV" os="34" version="5.1.0.6"/>' +
        '<track speed="1.25" course="271.5"/>',
    },
  ]);
});

test("proto3-omitted zeros decode as zero, unset markings as absent, and nothing is invented", () => {
  const bytes = frame(
    msg(
      2, // TakMessage.cotEvent
      str(1, "a-f-G"), // type
      str(5, "stationary"), // uid
      u64(6, sent), // sendTime
      u64(7, sent), // startTime
      u64(8, stale), // staleTime
      str(9, "h-e"), // how
      // lat, lon (10, 11) are 0 and omitted
      f64(12, 9999999), // hae, TAK's "unknown"
      // ce (13) omitted
      f64(14, 9999999), // le
      msg(
        15, // detail
        msg(2, str(2, "PAIKALLA")), // contact: callsign only, no endpoint
        msg(3), // group, empty
        msg(5), // status, battery 0 omitted
        msg(7), // track, speed and course 0 omitted
      ),
    ),
  );
  const [event] = decodeTakMessages(Uint8Array.from(bytes)).events;
  expect(event).toEqual({
    type: "a-f-G",
    uid: "stationary",
    how: "h-e",
    time: sent,
    start: sent,
    stale,
    lat: 0,
    lon: 0,
    hae: 9999999,
    ce: 0,
    le: 9999999,
    detail: '<contact callsign="PAIKALLA"/><status battery="0"/><track speed="0" course="0"/>',
  });
});

test("an event with no detail and no hae decodes with empty detail and hae 0", () => {
  const bytes = frame(msg(2, str(1, "a-u-G"), str(5, "bare"), u64(6, sent)));
  const [event] = decodeTakMessages(Uint8Array.from(bytes)).events;
  expect(event).toMatchObject({ uid: "bare", hae: 0, start: 0, stale: 0, how: "", detail: "" });
});

test("xmlDetail comes first, then structured elements in wire order", () => {
  const bytes = frame(
    msg(
      2, // TakMessage.cotEvent
      str(1, "a-f-G-U-C"), // type
      str(5, "mixed"), // uid
      msg(
        15, // detail
        msg(7, f64(1, 3)), // track: speed only
        str(1, '<__milsym id="SFGPUCI--------"/><remarks>Ryhmä &amp; ajoneuvo</remarks>'), // xmlDetail
        msg(2, str(2, "SEKA")), // contact: callsign
      ),
    ),
  );
  const [event] = decodeTakMessages(Uint8Array.from(bytes)).events;
  expect(event?.detail).toBe(
    '<__milsym id="SFGPUCI--------"/><remarks>Ryhmä &amp; ajoneuvo</remarks>' +
      '<track speed="3" course="0"/><contact callsign="SEKA"/>',
  );
});

test("streaming frames: multi-byte length, control messages, then a cut-off frame", () => {
  expect(atakPositionReport[1]).toBeGreaterThanOrEqual(0x80); // the length needs a 2-byte varint
  const control = frame(msg(1, u64(1, 1), u64(2, 1))); // TakMessage.takControl: min/maxProtoVersion
  const bytes = [...control, ...atakPositionReport, ...atakPositionReport.slice(0, 40)];
  const { events, error } = decodeTakMessages(Uint8Array.from(bytes));
  expect(events.map((e) => e.uid)).toEqual(["ANDROID-kettu23"]);
  expect(error?.message).toBe("truncated field");
});

test("a frame without the 0xbf magic byte is an error", () => {
  const { events, error } = decodeTakMessages(
    Uint8Array.from([0xbe, ...atakPositionReport.slice(1)]),
  );
  expect(events).toEqual([]);
  expect(error?.message).toBe("not a TAK protobuf message");
});

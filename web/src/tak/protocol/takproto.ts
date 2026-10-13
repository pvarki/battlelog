import type { CotEvent } from "./cot-event.ts";
import { type Field, fieldText, Reader, readFields, Writer } from "./protobuf.ts";

/**
 * TAK's streaming protobuf protocol, as spoken on the `/takproto/1` WebSocket:
 * each message is `0xbf`, a varint length, then a TakMessage. Field numbers
 * follow TAK's published protocol (TakMessage 2 = CotEvent; CotEvent 1 type,
 * 2–4 access/qos/opex, 5 uid, 6–8 send/start/stale epoch ms, 9 how,
 * 10–14 lat/lon/hae/ce/le, 15 Detail, 16 caveat, 17 releasableTo). Detail
 * carries some elements as structured messages and the rest as raw XML;
 * decoding turns the structured ones back into XML so the rest of the client
 * sees one detail format.
 */

const MAGIC = 0xbf;

const escapeAttr = (value: string | number) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const element = (name: string, attrs: Record<string, string | number | undefined>) => {
  const set = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== "");
  if (set.length === 0) return "";
  return `<${name} ${set.map(([k, v]) => `${k}="${escapeAttr(v as string | number)}"`).join(" ")}/>`;
};

const byNumber = (buf: Uint8Array | undefined) =>
  new Map<number, Field>(readFields(buf).map((f) => [f.field, f]));

const strings = (buf: Uint8Array | undefined) => {
  const m = byNumber(buf);
  return (n: number) => fieldText(m.get(n));
};

const detailXml = (buf: Uint8Array | undefined): string => {
  let xml = "";
  for (const f of readFields(buf)) {
    if (f.field === 1) xml = fieldText(f) + xml;
    else if (f.field === 2) {
      const s = strings(f.bytes);
      xml += element("contact", { endpoint: s(1), callsign: s(2) });
    } else if (f.field === 3) {
      const s = strings(f.bytes);
      xml += element("__group", { name: s(1), role: s(2) });
    } else if (f.field === 4) {
      const s = strings(f.bytes);
      xml += element("precisionlocation", { geopointsrc: s(1), altsrc: s(2) });
    } else if (f.field === 5) {
      xml += element("status", { battery: byNumber(f.bytes).get(1)?.varint ?? 0 });
    } else if (f.field === 6) {
      const s = strings(f.bytes);
      xml += element("takv", { device: s(1), platform: s(2), os: s(3), version: s(4) });
    } else if (f.field === 7) {
      const m = byNumber(f.bytes);
      xml += element("track", { speed: m.get(1)?.double ?? 0, course: m.get(2)?.double ?? 0 });
    }
  }
  return xml;
};

const decodeCotEvent = (buf: Uint8Array): CotEvent => {
  const m = byNumber(buf);
  const str = (n: number) => fieldText(m.get(n));
  // proto3 leaves zero values out, so a missing number is 0.
  const dbl = (n: number) => m.get(n)?.double ?? 0;
  const ms = (n: number) => m.get(n)?.varint ?? 0;
  const marking = (n: number) => str(n) || undefined;
  return {
    access: marking(2),
    qos: marking(3),
    opex: marking(4),
    caveat: marking(16),
    releasableTo: marking(17),
    uid: str(5),
    type: str(1),
    how: str(9),
    time: ms(6),
    start: ms(7),
    stale: ms(8),
    lat: dbl(10),
    lon: dbl(11),
    hae: dbl(12),
    ce: dbl(13),
    le: dbl(14),
    detail: detailXml(m.get(15)?.bytes),
  };
};

/**
 * CoT events in one WebSocket message; control messages yield nothing. A
 * malformed message ends decoding (its length can't be trusted to find the
 * next one) but keeps the events decoded before it.
 */
export const decodeTakMessages = (message: Uint8Array): { events: CotEvent[]; error?: Error } => {
  const reader = new Reader(message);
  const events: CotEvent[] = [];
  try {
    while (!reader.done) {
      if (reader.take(1)[0] !== MAGIC) throw new Error("not a TAK protobuf message");
      const takMessage = reader.take(reader.varint());
      const cot = readFields(takMessage).find((f) => f.field === 2)?.bytes;
      if (cot) events.push(decodeCotEvent(cot));
    }
  } catch (err) {
    return { events, error: err as Error };
  }
  return { events };
};

/** One framed TakMessage for `event`; the whole detail travels as XML, which TAK accepts. */
export const encodeTakMessage = (event: CotEvent): Uint8Array => {
  const detail = new Writer().string(1, event.detail).finish();
  const cot = new Writer()
    .string(1, event.type)
    .string(2, event.access ?? "")
    .string(3, event.qos ?? "")
    .string(4, event.opex ?? "")
    .string(5, event.uid)
    .uint(6, event.time)
    .uint(7, event.start)
    .uint(8, event.stale)
    .string(9, event.how)
    .double(10, event.lat)
    .double(11, event.lon)
    .double(12, event.hae)
    .double(13, event.ce)
    .double(14, event.le)
    .bytes(15, detail)
    .string(16, event.caveat ?? "")
    .string(17, event.releasableTo ?? "")
    .finish();
  const takMessage = new Writer().bytes(2, cot).finish();
  return Uint8Array.from([
    MAGIC,
    ...new Writer().varint(takMessage.length).finish(),
    ...takMessage,
  ]);
};

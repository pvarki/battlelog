/**
 * TAK's WebSocket (`/takproto/1`) speaks the streaming protobuf protocol:
 * `0xbf`, a varint length, then a TakMessage. Rather than a second parser for
 * protobuf, each CotEvent is turned back into CoT XML for the shared `parseCot`;
 * shapes, colours and remarks already travel as raw XML in `detail.xmlDetail`.
 * Field numbers: takproto `takmessage.proto`, `cotevent.proto`, `detail.proto`.
 */

const MAGIC = 0xbf;
const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH = 2;
const WIRE_32BIT = 5;

type Field = { field: number; varint?: number; double?: number; bytes?: Uint8Array };

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  get done() {
    return this.pos >= this.buf.length;
  }

  // Multiplies instead of shifting: epoch-ms times exceed 32 bits.
  varint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = this.buf[this.pos++];
      if (byte === undefined) throw new Error("truncated varint");
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) return value;
      scale *= 128;
    }
  }

  take(length: number): Uint8Array {
    if (this.pos + length > this.buf.length) throw new Error("truncated field");
    const out = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  next(): Field {
    const key = this.varint();
    const field = Math.floor(key / 8);
    switch (key & 7) {
      case WIRE_VARINT:
        return { field, varint: this.varint() };
      case WIRE_64BIT: {
        const bytes = this.take(8);
        return {
          field,
          double: new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true),
        };
      }
      case WIRE_LENGTH:
        return { field, bytes: this.take(this.varint()) };
      case WIRE_32BIT:
        this.take(4);
        return { field };
      default:
        throw new Error(`unsupported wire type ${key & 7}`);
    }
  }
}

const utf8 = new TextDecoder();
const text = (f: Field) => (f.bytes ? utf8.decode(f.bytes) : "");

const fields = (buf: Uint8Array) => {
  const reader = new Reader(buf);
  const out: Field[] = [];
  while (!reader.done) out.push(reader.next());
  return out;
};

/** Field number → value for a small message whose fields are all strings. */
const strings = (buf: Uint8Array | undefined) =>
  Object.fromEntries(fields(buf ?? new Uint8Array()).map((f) => [f.field, text(f)]));

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

const detailXml = (buf: Uint8Array | undefined): string => {
  let xml = "";
  let extra = "";
  for (const f of fields(buf ?? new Uint8Array())) {
    if (f.field === 1) xml = text(f);
    else if (f.field === 2) {
      const c = strings(f.bytes);
      extra += element("contact", { endpoint: c[1], callsign: c[2] });
    } else if (f.field === 3) {
      const g = strings(f.bytes);
      extra += element("__group", { name: g[1], role: g[2] });
    } else if (f.field === 5) {
      const battery = fields(f.bytes ?? new Uint8Array()).find((s) => s.field === 1)?.varint;
      extra += element("status", { battery });
    } else if (f.field === 6) {
      const v = strings(f.bytes);
      extra += element("takv", { device: v[1], platform: v[2], os: v[3], version: v[4] });
    }
  }
  return xml + extra;
};

const iso = (ms: number | undefined) => new Date(ms ?? 0).toISOString();

const cotEventXml = (buf: Uint8Array): string => {
  const e = new Map<number, Field>(fields(buf).map((f) => [f.field, f]));
  const str = (n: number) => text(e.get(n) ?? { field: n });
  const dbl = (n: number) => e.get(n)?.double ?? 0;
  const ms = (n: number) => e.get(n)?.varint;
  const event = {
    version: "2.0",
    uid: str(5),
    type: str(1),
    how: str(9),
    time: iso(ms(6)),
    start: iso(ms(7)),
    stale: iso(ms(8)),
  };
  const point = { lat: dbl(10), lon: dbl(11), hae: dbl(12), ce: dbl(13), le: dbl(14) };
  const attrs = (o: Record<string, string | number>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(" ");
  return `<event ${attrs(event)}><point ${attrs(point)}/><detail>${detailXml(e.get(15)?.bytes)}</detail></event>`;
};

/**
 * CoT XML for each event in one WebSocket message; control messages yield
 * nothing. A malformed message ends decoding (its length can't be trusted to
 * find the next one) but keeps the events decoded before it.
 */
export const takprotoToCot = (message: Uint8Array): { events: string[]; error?: Error } => {
  const reader = new Reader(message);
  const events: string[] = [];
  try {
    while (!reader.done) {
      if (reader.take(1)[0] !== MAGIC) throw new Error("not a TAK protobuf message");
      const takMessage = reader.take(reader.varint());
      const cot = fields(takMessage).find((f) => f.field === 2)?.bytes;
      if (cot) events.push(cotEventXml(cot));
    }
  } catch (err) {
    return { events, error: err as Error };
  }
  return { events };
};

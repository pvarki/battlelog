/** The few protobuf wire-format pieces TAK's messages use; no schema, no codegen. */

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH = 2;
const WIRE_32BIT = 5;

export type Field = { field: number; varint?: number; double?: number; bytes?: Uint8Array };

export class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  get done() {
    return this.pos >= this.buf.length;
  }

  // Multiplies instead of shifting: epoch-ms times exceed 32 bits. A varint
  // is at most 10 bytes; anything past 2^53 isn't a value we can use anyway.
  varint(): number {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      const byte = this.buf[this.pos++];
      if (byte === undefined) throw new Error("truncated varint");
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) {
        if (!Number.isSafeInteger(value)) throw new Error("varint out of range");
        return value;
      }
      scale *= 128;
    }
    throw new Error("varint too long");
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

export const readFields = (buf: Uint8Array | undefined): Field[] => {
  const reader = new Reader(buf ?? new Uint8Array());
  const out: Field[] = [];
  while (!reader.done) out.push(reader.next());
  return out;
};

const utf8Decoder = new TextDecoder();
export const fieldText = (f: Field | undefined) => (f?.bytes ? utf8Decoder.decode(f.bytes) : "");

const utf8Encoder = new TextEncoder();

export class Writer {
  private chunks: number[] = [];

  varint(value: number): this {
    let v = value;
    while (v >= 0x80) {
      this.chunks.push((v % 128) | 0x80);
      v = Math.floor(v / 128);
    }
    this.chunks.push(v);
    return this;
  }

  private key(field: number, wire: number) {
    return this.varint(field * 8 + wire);
  }

  uint(field: number, value: number): this {
    return this.key(field, WIRE_VARINT).varint(value);
  }

  double(field: number, value: number): this {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    this.key(field, WIRE_64BIT);
    this.chunks.push(...bytes);
    return this;
  }

  bytes(field: number, value: Uint8Array): this {
    this.key(field, WIRE_LENGTH).varint(value.length);
    for (const b of value) this.chunks.push(b);
    return this;
  }

  string(field: number, value: string): this {
    return value ? this.bytes(field, utf8Encoder.encode(value)) : this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

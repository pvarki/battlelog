import { describe, expect, it } from "vitest";
import { fixOpusGranules, oggCrc, opusPacketSamples } from "./ogg.ts";

/** One Ogg page holding whole packets (each < 255 bytes). */
const page = (packets: Uint8Array[], granule: bigint, sequence: number, headerType = 0) => {
  const body = packets.flatMap((p) => [...p]);
  const bytes = new Uint8Array(27 + packets.length + body.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("OggS"));
  bytes[5] = headerType;
  view.setBigUint64(6, granule, true);
  view.setUint32(14, 1234, true);
  view.setUint32(18, sequence, true);
  bytes[26] = packets.length;
  bytes.set(
    packets.map((p) => p.length),
    27,
  );
  bytes.set(body, 27 + packets.length);
  view.setUint32(22, oggCrc(bytes), true);
  return bytes;
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const text = (s: string) => new TextEncoder().encode(s);
// TOC 0x08: SILK config 1 (20 ms), one frame → 960 samples.
const frame20ms = Uint8Array.of(0x08, 0xaa, 0xbb);

describe("ogg", () => {
  it("implements Ogg's CRC-32 (standard check value)", () => {
    expect(oggCrc(text("123456789"))).toBe(0x89a1897f);
  });

  it("counts Opus samples from the TOC byte", () => {
    expect(opusPacketSamples(frame20ms)).toBe(960);
    expect(opusPacketSamples(Uint8Array.of(0xf8 | 1))).toBe(1920); // CELT 20 ms, 2 frames
    expect(opusPacketSamples(Uint8Array.of(0x08 | 3, 3))).toBe(2880); // 3 frames
  });

  it("rewrites audio-page granules as running sample counts with valid CRCs", () => {
    const file = concat(
      page([concat(text("OpusHead"), Uint8Array.of(1, 1, 0x38, 1))], 0n, 0, 2),
      page([text("OpusTags")], 0n, 1),
      page([frame20ms, frame20ms], 0n, 2),
      page([frame20ms], 960n, 3, 4),
    );
    const fixed = new Uint8Array(fixOpusGranules(file.buffer) ?? new ArrayBuffer(0));
    const view = new DataView(fixed.buffer);
    const thirdPage = 27 + 1 + 12 + 27 + 1 + 8;
    const fourthPage = thirdPage + 27 + 2 + 6;
    expect(view.getBigUint64(thirdPage + 6, true)).toBe(1920n);
    expect(view.getBigUint64(fourthPage + 6, true)).toBe(2880n);
    for (const start of [thirdPage, fourthPage]) {
      const length = start === thirdPage ? 27 + 2 + 6 : 27 + 1 + 3;
      const pageBytes = fixed.slice(start, start + length);
      const crc = new DataView(pageBytes.buffer).getUint32(22, true);
      new DataView(pageBytes.buffer).setUint32(22, 0, true);
      expect(oggCrc(pageBytes)).toBe(crc);
    }
  });

  it("leaves non-Opus input alone", () => {
    expect(fixOpusGranules(text("RIFF....WAVE").buffer)).toBeUndefined();
  });
});

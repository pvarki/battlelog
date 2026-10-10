/**
 * Repairs Ogg/Opus granule positions. Some voice-message recorders (seen from
 * Element X) start the audio pages at granule 0, i.e. a negative start time —
 * Chrome shrugs, Firefox rejects the file with NS_ERROR_DOM_MEDIA_METADATA_ERR.
 * Rewrites every audio page's granule as the running decoded-sample count
 * (RFC 7845 §4) and re-checksums the page. Audio data is untouched.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let r = i << 24;
  for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
  return r >>> 0;
});

/** Ogg's CRC-32: poly 0x04c11db7, init 0, no reflection, no final xor. */
export const oggCrc = (bytes: Uint8Array): number => {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ b) & 0xff] ?? 0)) >>> 0;
  return crc;
};

/** Samples (at 48 kHz) one Opus packet decodes to, from its TOC byte (RFC 6716 §3.1). */
export const opusPacketSamples = (packet: Uint8Array): number => {
  const toc = packet[0] ?? 0;
  const config = toc >> 3;
  const frameSamples =
    config < 12
      ? [480, 960, 1920, 2880][config % 4]
      : config < 16
        ? [480, 960][config % 2]
        : [120, 240, 480, 960][config % 4];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return (frameSamples ?? 0) * frames;
};

/** Returns a copy with recomputed granules, or undefined if this isn't Ogg/Opus. */
export const fixOpusGranules = (input: ArrayBuffer): ArrayBuffer | undefined => {
  const bytes = new Uint8Array(input.slice(0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  let packetIndex = 0;
  let samples = 0;
  let pending: number[] = [];

  while (offset + 27 <= bytes.length) {
    if (view.getUint32(offset) !== 0x4f676753) return undefined; // "OggS"
    const segmentCount = bytes[offset + 26] ?? 0;
    const lacing = bytes.subarray(offset + 27, offset + 27 + segmentCount);
    const headerLength = 27 + segmentCount;
    const bodyLength = lacing.reduce((sum, n) => sum + n, 0);
    let cursor = offset + headerLength;
    let completedOnPage = false;

    for (const length of lacing) {
      for (let i = 0; i < length; i++) pending.push(bytes[cursor + i] ?? 0);
      cursor += length;
      if (length === 255) continue;
      const packet = Uint8Array.from(pending);
      pending = [];
      if (packetIndex === 0 && new TextDecoder().decode(packet.subarray(0, 8)) !== "OpusHead") {
        return undefined;
      }
      if (packetIndex >= 2) {
        samples += opusPacketSamples(packet);
        completedOnPage = true;
      }
      packetIndex++;
    }

    if (packetIndex > 2 && completedOnPage) {
      view.setBigUint64(offset + 6, BigInt(samples), true);
      view.setUint32(offset + 22, 0, true);
      const page = bytes.subarray(offset, offset + headerLength + bodyLength);
      view.setUint32(offset + 22, oggCrc(page), true);
    }
    offset += headerLength + bodyLength;
  }
  return packetIndex > 0 ? bytes.buffer : undefined;
};

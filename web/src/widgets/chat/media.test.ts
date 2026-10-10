import { describe, expect, it } from "vitest";
import { decryptAttachment, encryptAttachment } from "./media.ts";

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=+$/, "");

const encrypt = async (plaintext: Uint8Array<ArrayBuffer>) => {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = new Uint8Array(16);
  iv.set(crypto.getRandomValues(new Uint8Array(8)));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-CTR", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-CTR", counter: iv, length: 64 },
    key,
    plaintext,
  );
  const jwkK = b64(rawKey).replace(/\+/g, "-").replace(/\//g, "_");
  return {
    ciphertext,
    file: {
      key: { k: jwkK },
      iv: b64(iv),
      hashes: { sha256: b64(await crypto.subtle.digest("SHA-256", ciphertext)) },
    },
  };
};

describe("decryptAttachment", () => {
  it("round-trips a Matrix-style encrypted attachment", async () => {
    const plaintext = new TextEncoder().encode("image bytes");
    const { ciphertext, file } = await encrypt(plaintext);
    expect(new Uint8Array(await decryptAttachment(ciphertext, file))).toEqual(plaintext);
  });

  it("rejects ciphertext that doesn't match the sender's hash", async () => {
    const { ciphertext, file } = await encrypt(new TextEncoder().encode("image bytes"));
    const bytes = new Uint8Array(ciphertext);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    await expect(decryptAttachment(ciphertext, file)).rejects.toThrow("hash mismatch");
  });

  it("decrypts what encryptAttachment produced", async () => {
    const plaintext = new TextEncoder().encode("outgoing upload");
    const { ciphertext, file } = await encryptAttachment(plaintext.buffer);
    // 64 random IV bits, then a zeroed 64-bit block counter.
    expect(atob(`${file.iv}==`).slice(8)).toBe("\0".repeat(8));
    expect(new Uint8Array(await decryptAttachment(ciphertext, file))).toEqual(plaintext);
  });
});

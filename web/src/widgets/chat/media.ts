import type { MatrixClient } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "./mentions.ts";

/** `content.file` of an attachment in an E2EE room (spec: EncryptedFile). */
export type EncryptedFile = {
  url: string;
  key: { k: string; [jwkField: string]: unknown };
  iv: string;
  hashes: { sha256: string };
};

// Spec mixes unpadded base64 (iv, hashes) and base64url (JWK `k`).
const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")), (c) =>
    c.charCodeAt(0),
  );
};

const toBase64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=+$/, "");

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/** AES-CTR decrypt after checking the ciphertext against the sender's sha256. */
export const decryptAttachment = async (
  ciphertext: ArrayBuffer,
  file: Pick<EncryptedFile, "key" | "iv" | "hashes">,
): Promise<ArrayBuffer> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext));
  if (!sameBytes(digest, fromBase64(file.hashes.sha256))) {
    throw new Error("Attachment hash mismatch");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64(file.key.k),
    { name: "AES-CTR" },
    false,
    ["decrypt"],
  );
  return crypto.subtle.decrypt(
    { name: "AES-CTR", counter: fromBase64(file.iv), length: 64 },
    key,
    ciphertext,
  );
};

/** Authenticated media download (Synapse ≥1.120 refuses unauthenticated). */
const download = async (client: MatrixClient, mxc: string): Promise<ArrayBuffer> => {
  const url = client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
  if (!url) throw new Error("Not a Matrix media URL");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${client.getAccessToken()}` } });
  if (!res.ok) throw new Error(`Media download failed (${res.status})`);
  return res.arrayBuffer();
};

/** Plain or encrypted attachment → blob, ready for an object URL. */
export const fetchAttachment = async (
  client: MatrixClient,
  source: { url?: string; file?: EncryptedFile },
  mimetype: string | undefined,
): Promise<Blob> => {
  const bytes = source.file
    ? await decryptAttachment(await download(client, source.file.url), source.file)
    : await download(client, source.url ?? "");
  return new Blob([bytes], { type: mimetype });
};

/**
 * Encrypts an upload for an E2EE room (spec: EncryptedFile v2): random 256-bit
 * AES-CTR key, IV of 64 random bits + a 64-bit zero counter, sha256 over the
 * ciphertext so receivers can verify before decrypting.
 */
export const encryptAttachment = async (
  plaintext: ArrayBuffer,
): Promise<{
  ciphertext: ArrayBuffer;
  file: Omit<EncryptedFile, "url"> & Record<string, unknown>;
}> => {
  const iv = new Uint8Array(16);
  iv.set(crypto.getRandomValues(new Uint8Array(8)));
  const key = await crypto.subtle.generateKey({ name: "AES-CTR", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-CTR", counter: iv, length: 64 },
    key,
    plaintext,
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return {
    ciphertext,
    file: {
      v: "v2",
      key: {
        kty: "oct",
        key_ops: ["encrypt", "decrypt"],
        alg: "A256CTR",
        k: jwk.k ?? "",
        ext: true,
      },
      iv: toBase64(iv),
      hashes: { sha256: toBase64(await crypto.subtle.digest("SHA-256", ciphertext)) },
    },
  };
};

const imageSize = async (file: File) => {
  if (!file.type.startsWith("image/")) return {};
  try {
    const bitmap = await createImageBitmap(file);
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
};

const msgtypeFor = (mimetype: string) => {
  if (mimetype.startsWith("image/")) return "m.image";
  if (mimetype.startsWith("audio/")) return "m.audio";
  if (mimetype.startsWith("video/")) return "m.video";
  return "m.file";
};

// Firefox types any .ogg as video/ogg; audio-only extensions are audio.
const mimetypeOf = (file: File) => {
  if (/\.(ogg|oga|opus)$/i.test(file.name) && /^(video|application)\/ogg$/.test(file.type)) {
    return "audio/ogg";
  }
  return file.type || "application/octet-stream";
};

/** Uploads a file (encrypting it first in E2EE rooms) and posts it to the room. */
export const sendAttachment = async (
  client: MatrixClient,
  roomId: string,
  file: File,
  relation: object = {},
) => {
  const mimetype = mimetypeOf(file);
  const info = { mimetype, size: file.size, ...(await imageSize(file)) };
  const encrypted = await client.getCrypto()?.isEncryptionEnabledInRoom(roomId);
  let source: { url: string } | { file: EncryptedFile & Record<string, unknown> };
  if (encrypted) {
    const { ciphertext, file: keys } = await encryptAttachment(await file.arrayBuffer());
    const { content_uri } = await client.uploadContent(new Blob([ciphertext]), {
      type: "application/octet-stream",
      includeFilename: false,
    });
    source = { file: { ...keys, url: content_uri } };
  } else {
    const { content_uri } = await client.uploadContent(file, { type: mimetype, name: file.name });
    source = { url: content_uri };
  }
  await client.sendMessage(roomId, {
    msgtype: msgtypeFor(mimetype),
    body: file.name,
    filename: file.name,
    info,
    ...source,
    ...relation,
  } as unknown as RoomMessageEventContent);
};

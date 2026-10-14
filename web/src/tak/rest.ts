import { pvarkiDeployment } from "../deployment.ts";
import type { CotEvent } from "./protocol/cot-event.ts";
import { cotXmlPieces, parseCotXml } from "./protocol/cot-xml.ts";
import { SLICE_SIZE, yieldToMain } from "./slices.ts";

/**
 * Where TAK Server's REST API and WebSocket live. The browser talks to TAK
 * directly and TAK authenticates the user by their own client certificate,
 * so every request carries credentials.
 */
export const takBaseUrl = (): string =>
  import.meta.env.VITE_TAK_URL || `https://tak.${pvarkiDeployment()}:8443`;

export class TakRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`TAK ${path}: ${status}`);
  }
}

/** The body, read only until it passes `max` bytes: a missing or false Content-Length can't make us buffer more. */
export const readCapped = async (
  res: Response,
  max: number,
  tooLarge: () => Error,
): Promise<Uint8Array<ArrayBuffer>> => {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

/**
 * GET a Marti path as text. TAK answers 404 for "nothing in range", which
 * reads as "". With `maxBytes` a larger answer is refused before it's all in memory.
 */
export const takGetText = async (
  path: string,
  signal?: AbortSignal,
  maxBytes?: number,
): Promise<string> => {
  const res = await fetch(`${takBaseUrl()}${path}`, { credentials: "include", signal });
  if (res.status === 404) return "";
  if (!res.ok) throw new TakRequestError(path, res.status);
  if (maxBytes === undefined) return res.text();
  const tooLarge = () =>
    new Error(
      `TAK's answer is over ${Math.round(maxBytes / 1_048_576)} MB; ask for less at a time`,
    );
  return new TextDecoder().decode(await readCapped(res, maxBytes, tooLarge));
};

// A busy server's day of history or a week of one unit's fixes; parsing more would exhaust the tab.
const MAX_HISTORY_BYTES = 64 * 1_048_576;

export type TakWrite = {
  method: "PUT" | "POST" | "DELETE";
  path: string;
  body?: unknown;
};

/** Sends a change to TAK; `missionToken` authorizes writes to a subscribed mission. */
export const takSend = async (
  { method, path, body }: TakWrite,
  missionToken?: string,
): Promise<string> => {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (missionToken) headers.MissionAuthorization = `Bearer ${missionToken}`;
  const res = await fetch(`${takBaseUrl()}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new TakRequestError(path.split("?")[0] as string, res.status);
  return res.text();
};

/** CoT events TAK archived between `start` and `end`; TAK caps the window at 24 h. */
/** `parseCotXml` a slice at a time: thousands of events parsed in one go block the page. */
export const parseCotXmlInSlices = async (xml: string, options?: { strict?: boolean }) => {
  // A wrapper opened but never closed is a cut-off download, which strict parsing must report.
  if (options?.strict && /<events\b(?![^>]*\/>)[^>]*>/.test(xml) && !/<\/events>\s*$/.test(xml))
    throw new Error("TAK sent CoT XML that doesn't parse");
  const events: CotEvent[] = [];
  for (const [i, piece] of cotXmlPieces(xml, SLICE_SIZE).entries()) {
    if (i > 0) await yieldToMain();
    try {
      events.push(...parseCotXml(piece, { strict: true }));
    } catch {
      // Cut in the wrong place, e.g. "</event>" inside CDATA: read it whole, as before slicing.
      return parseCotXml(xml, options);
    }
  }
  return events;
};

export const fetchArchive = async (start: Date, end: Date, signal?: AbortSignal) => {
  // Drawings and deletes are only returned with isFiltered=false.
  const query = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    isFiltered: "false",
  });
  const xml = await takGetText(`/Marti/api/cot/sa?${query}`, signal, MAX_HISTORY_BYTES);
  return parseCotXmlInSlices(xml, { strict: true });
};

/** The latest stored copy of one item, or undefined when TAK has none. */
export const fetchLatestCot = async (
  uid: string,
  signal?: AbortSignal,
): Promise<CotEvent | undefined> =>
  parseCotXml(await takGetText(`/Marti/api/cot/xml/${encodeURIComponent(uid)}`, signal))[0];

/** Every stored copy of one item from the last `seconds`, e.g. a user's past positions. */
export const fetchHistory = async (uid: string, seconds: number, signal?: AbortSignal) =>
  parseCotXml(
    await takGetText(
      `/Marti/api/cot/xml/${encodeURIComponent(uid)}/all?secago=${Math.round(seconds)}`,
      signal,
      MAX_HISTORY_BYTES,
    ),
  );

/** Where this browser downloads an uploaded file. */
export const contentUrl = (hash: string) =>
  `${takBaseUrl()}/Marti/sync/content?hash=${encodeURIComponent(hash)}`;

/**
 * TAK's address as other TAK clients reach it. Same as ours in a deployment;
 * in local dev ours is the /tak proxy, which means nothing to an ATAK phone.
 */
export const takPublicUrl = (): string => import.meta.env.VITE_TAK_PUBLIC_URL || takBaseUrl();

/** A download link to write into CoT, where other clients will read it. */
export const publicContentUrl = (hash: string) =>
  `${takPublicUrl()}/Marti/sync/content?hash=${encodeURIComponent(hash)}`;

/** Stores a file on TAK Server and returns its content hash. */
export const uploadFile = async (file: Blob, name: string, creatorUid: string): Promise<string> => {
  const query = new URLSearchParams({ name, keywords: "battlelog", creatorUid });
  const res = await fetch(`${takBaseUrl()}/Marti/sync/upload?${query}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new TakRequestError("/Marti/sync/upload", res.status);
  const { Hash } = (await res.json()) as { Hash?: string };
  if (!Hash) throw new Error("TAK upload returned no hash");
  return Hash;
};

const CONTENT_URL = /\/Marti\/sync\/content\?hash=([0-9a-f]{64})/gi;

/** TAK-stored files linked from a text, e.g. photos in remarks, as this browser fetches them. */
export const contentLinks = (text: string | undefined): string[] =>
  [...(text ?? "").matchAll(CONTENT_URL)].map((m) => contentUrl(m[1] as string));

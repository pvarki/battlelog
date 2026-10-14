import { pvarkiDeployment } from "../deployment.ts";
import type { CotEvent } from "./protocol/cot-event.ts";
import { parseCotXml } from "./protocol/cot-xml.ts";

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

/** GET a Marti path as text. TAK answers 404 for "nothing in range", which reads as "". */
export const takGetText = async (path: string, signal?: AbortSignal): Promise<string> => {
  const res = await fetch(`${takBaseUrl()}${path}`, { credentials: "include", signal });
  if (res.status === 404) return "";
  if (!res.ok) throw new TakRequestError(path, res.status);
  return res.text();
};

/** CoT events TAK archived between `start` and `end`; TAK caps the window at 24 h. */
export const fetchArchive = async (start: Date, end: Date, signal?: AbortSignal) => {
  // Drawings and deletes are only returned with isFiltered=false.
  const query = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    isFiltered: "false",
  });
  return parseCotXml(await takGetText(`/Marti/api/cot/sa?${query}`, signal), { strict: true });
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

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
  return parseCotXml(await takGetText(`/Marti/api/cot/sa?${query}`, signal));
};

/** The latest stored copy of one item, or undefined when TAK has none. */
export const fetchLatestCot = async (
  uid: string,
  signal?: AbortSignal,
): Promise<CotEvent | undefined> =>
  parseCotXml(await takGetText(`/Marti/api/cot/xml/${encodeURIComponent(uid)}`, signal))[0];

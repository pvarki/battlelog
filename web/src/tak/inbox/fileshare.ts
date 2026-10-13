import type { CotEvent } from "../cot.ts";
import { childNamed } from "../protocol/cot-event.ts";

/**
 * Receiving data packages: ATAK announces a package it put on TAK Server
 * with a `b-f-t-r` file-share CoT naming its hash; the package is a zip with
 * `MANIFEST/manifest.xml` listing its contents, each optionally tied to a
 * map item by uid.
 */

export const FILE_SHARE_TYPE = "b-f-t-r";

/** A package on TAK Server, by the hash TAK stores it under. */
export type PackageRef = { hash: string; name: string; size: number };

export type FileShare = PackageRef & {
  id: string;
  senderUrl: string;
  senderCallsign: string;
  time: number;
};

const SHA256 = /^[0-9a-f]{64}$/i;

const parseXml = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.getElementsByTagName("parsererror").length > 0 ? undefined : doc.documentElement;
};

/** The package announced by a `b-f-t-r` event; undefined for anything else. */
export const parseFileShare = (event: CotEvent): FileShare | undefined => {
  if (event.type !== FILE_SHARE_TYPE) return undefined;
  const detail = parseXml(`<detail>${event.detail}</detail>`);
  const share = detail && childNamed(detail, "fileshare");
  const attr = (name: string) => share?.getAttribute(name) ?? "";
  const hash = attr("sha256");
  if (!SHA256.test(hash)) return undefined;
  return {
    id: event.uid,
    hash: hash.toLowerCase(),
    name: attr("name") || attr("filename"),
    size: Number(attr("sizeInBytes")) || 0,
    senderUrl: attr("senderUrl"),
    senderCallsign: attr("senderCallsign"),
    time: event.time,
  };
};

/**
 * Whether the announced download is on a TAK Server we know. A package
 * offered from the sender's own device, or another server, is never fetched.
 */
export const isOnTak = (senderUrl: string, takUrls: string[]): boolean => {
  try {
    const url = new URL(senderUrl);
    return (
      url.pathname === "/Marti/sync/content" &&
      takUrls.some((tak) => new URL(tak, window.location.href).host === url.host)
    );
  } catch {
    return false;
  }
};

export const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export type PackageFile = { path: string; name: string; bytes: Uint8Array };

export type PackageContents = {
  name: string | undefined;
  cot: PackageFile[];
  /** Files ATAK files under a map item, e.g. a marker's photos. */
  attachments: (PackageFile & { uid: string })[];
  other: PackageFile[];
};

const MANIFEST = "MANIFEST/manifest.xml";

const fileName = (path: string) => path.split("/").pop() || path;

/** Sorts a package's files by what the manifest says they are. */
export const readPackage = (files: Record<string, Uint8Array>): PackageContents => {
  const manifestBytes = files[MANIFEST];
  const manifest = manifestBytes && parseXml(new TextDecoder().decode(manifestBytes));
  const parameter = (el: Element | undefined, name: string) =>
    Array.from(el?.children ?? [])
      .find((p) => p.tagName === "Parameter" && p.getAttribute("name") === name)
      ?.getAttribute("value") ?? undefined;
  const contents = Array.from(manifest?.getElementsByTagName("Content") ?? []);
  const entryOf = (path: string) => contents.find((c) => c.getAttribute("zipEntry") === path);
  const result: PackageContents = {
    name: parameter(manifest?.getElementsByTagName("Configuration")[0], "name"),
    cot: [],
    attachments: [],
    other: [],
  };
  for (const [path, bytes] of Object.entries(files)) {
    if (path === MANIFEST || path.endsWith("/")) continue;
    const entry = entryOf(path);
    if (entry?.getAttribute("ignore") === "true") continue;
    const file = { path, name: fileName(path), bytes };
    const uid = parameter(entry, "uid");
    if (path.toLowerCase().endsWith(".cot")) result.cot.push(file);
    else if (uid) result.attachments.push({ ...file, uid });
    else result.other.push(file);
  }
  return result;
};

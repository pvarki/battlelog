import { useSyncExternalStore } from "react";
import { type CotEvent, type TakItem, toChange } from "./cot.ts";
import { childNamed } from "./protocol/cot-event.ts";
import { fetchLatestCot, publicContentUrl, uploadFile } from "./rest.ts";
import { sendCot } from "./session.ts";

/**
 * Changes to existing TAK items. An edit rewrites only the detail elements it
 * is about and sends everything else back verbatim, so other clients'
 * extensions survive. TAK doesn't echo a sender's own events, so after
 * sending, the item is read back from TAK's REST API to confirm it was stored.
 */

export type WriteState = "sending" | "confirmed" | "unconfirmed" | "failed";

const VERIFY_DELAY_MS = 2_000;

let writes = new Map<string, WriteState>();
const listeners = new Set<() => void>();

const setWrite = (uid: string, state: WriteState) => {
  writes = new Map(writes).set(uid, state);
  for (const listener of listeners) listener();
};

/** How the latest change to each item went, by uid. */
export const useWrites = (): ReadonlyMap<string, WriteState> =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => writes,
  );

const parseDetail = (xml: string) =>
  new DOMParser().parseFromString(`<detail>${xml}</detail>`, "application/xml");

const serializeChildren = (detail: Element) => {
  const serializer = new XMLSerializer();
  return Array.from(detail.childNodes)
    .map((n) => serializer.serializeToString(n))
    .join("");
};

/** The element `name` directly under detail, created when missing. */
export const ensureChild = (detail: Element, name: string): Element => {
  const existing = childNamed(detail, name);
  if (existing) return existing;
  const created = detail.ownerDocument.createElementNS(null, name);
  detail.appendChild(created);
  return created;
};

const DAY_MS = 86_400_000;
// What ATAK gives an item it re-sends: shapes a day, markers a year.
const lifetimeOf = (type: string) =>
  type.startsWith("u-d-") || type === "b-m-r" ? DAY_MS : 365 * DAY_MS;

/**
 * The item's event re-issued now with `edit` applied to its detail; uid,
 * creator links and markings stay as they arrived, like ATAK does.
 */
export const editEvent = (
  item: TakItem,
  edit: (detail: Element) => void,
  now = Date.now(),
): CotEvent => {
  const doc = parseDetail(item.event.detail);
  edit(doc.documentElement);
  return {
    ...item.event,
    time: now,
    start: now,
    stale: now + lifetimeOf(item.type),
    detail: serializeChildren(doc.documentElement),
  };
};

export const setCallsign = (detail: Element, callsign: string) =>
  ensureChild(detail, "contact").setAttribute("callsign", callsign);

export const setRemarks = (detail: Element, remarks: string) => {
  ensureChild(detail, "remarks").textContent = remarks;
};

/** The symbol code in both places ATAK reads it from, so every client redraws it. */
export const setSymbol = (detail: Element, sidc: string) => {
  ensureChild(detail, "__milicon").setAttribute("id", sidc);
  ensureChild(detail, "__milsym").setAttribute("id", sidc);
};

/** Sends the item and confirms with TAK that it stored it; true once confirmed. */
export const publish = async (event: CotEvent): Promise<boolean> => {
  setWrite(event.uid, "sending");
  if (!sendCot(event)) {
    setWrite(event.uid, "failed");
    return false;
  }
  await new Promise((resolve) => setTimeout(resolve, VERIFY_DELAY_MS));
  try {
    const stored = await fetchLatestCot(event.uid);
    const confirmed = !!stored && stored.time >= event.time;
    setWrite(event.uid, confirmed ? "confirmed" : "unconfirmed");
    return confirmed;
  } catch {
    setWrite(event.uid, "unconfirmed");
    return false;
  }
};

/**
 * Uploads a photo to TAK and adds its download link to the item's remarks,
 * which every TAK client shows. Throws when the upload fails, so nothing is
 * sent for a photo TAK doesn't have.
 */
export const attachPhotoLink = async (item: TakItem, photo: File, callsign: string) => {
  setWrite(item.uid, "sending");
  let hash: string;
  try {
    hash = await uploadFile(photo, photo.name || "photo.jpg", `BattleLog-${callsign}`);
  } catch (err) {
    setWrite(item.uid, "failed");
    throw err;
  }
  // The upload can take a while; changes made meanwhile must survive the link.
  const latest = await fetchLatestCot(item.uid).catch(() => undefined);
  const change = latest && toChange(latest);
  const current = change?.kind === "upsert" && change.item.time > item.time ? change.item : item;
  const line = `Photo: ${publicContentUrl(hash)}`;
  await publish(
    editEvent(current, (detail) =>
      setRemarks(detail, current.remarks ? `${current.remarks}\n${line}` : line),
    ),
  );
};

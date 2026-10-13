import { useSyncExternalStore } from "react";
import type { CotEvent, TakItem } from "./cot.ts";
import { childNamed } from "./protocol/cot-event.ts";
import { fetchLatestCot } from "./rest.ts";
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

/**
 * The item's event re-issued now with `edit` applied to its detail. The stale
 * time keeps the item's original lifetime, so an edit doesn't make a
 * long-lived marker expire sooner.
 */
export const editEvent = (
  item: TakItem,
  edit: (detail: Element) => void,
  now = Date.now(),
): CotEvent => {
  const doc = parseDetail(item.event.detail);
  edit(doc.documentElement);
  const lifetime = Math.max(item.event.stale - item.event.time, 0);
  return {
    ...item.event,
    time: now,
    start: now,
    stale: now + lifetime,
    detail: serializeChildren(doc.documentElement),
  };
};

export const setCallsign = (detail: Element, callsign: string) =>
  ensureChild(detail, "contact").setAttribute("callsign", callsign);

export const setRemarks = (detail: Element, remarks: string) => {
  ensureChild(detail, "remarks").textContent = remarks;
};

/** Sends the changed item and confirms with TAK that it stored it. */
export const publish = async (event: CotEvent) => {
  setWrite(event.uid, "sending");
  if (!sendCot(event)) {
    setWrite(event.uid, "failed");
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, VERIFY_DELAY_MS));
  try {
    const stored = await fetchLatestCot(event.uid);
    setWrite(event.uid, stored && stored.time >= event.time ? "confirmed" : "unconfirmed");
  } catch {
    setWrite(event.uid, "unconfirmed");
  }
};

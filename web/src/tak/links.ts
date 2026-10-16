import type { EventResponse } from "../api.ts";
import type { TakItem } from "./cot.ts";

/**
 * What a log entry stores at `data.tak` to say which TAK item it is about. The
 * entry's own `locationPoint` is where the item was at `observedAt`, never
 * followed live: a moving drone must not drag yesterday's entry along.
 */
export type TakLink = { uid: string; callsign?: string; cotType: string; observedAt: string };

export const takLinkOf = (item: TakItem, at: number): TakLink => ({
  uid: item.uid,
  ...(item.callsign ? { callsign: item.callsign } : {}),
  cotType: item.type,
  observedAt: new Date(at).toISOString(),
});

export const parseTakLink = (value: unknown): TakLink | undefined => {
  const link = value as Partial<TakLink> | null | undefined;
  if (typeof link !== "object" || link === null) return undefined;
  const { uid, callsign, cotType, observedAt } = link;
  if (typeof uid !== "string" || !uid || typeof cotType !== "string") return undefined;
  if (typeof observedAt !== "string") return undefined;
  return { uid, ...(typeof callsign === "string" ? { callsign } : {}), cotType, observedAt };
};

export const linkOfEvent = (event: Pick<EventResponse, "data">): TakLink | undefined =>
  parseTakLink((event.data as { tak?: unknown } | null)?.tak);

/** `useLiveEvents` options for the events linked to `uid`, mirroring the server's `takUid` filter. */
export const linkedTo = (uid: string) => ({
  query: { takUid: uid },
  match: (event: Pick<EventResponse, "data">) =>
    (event.data as { tak?: { uid?: unknown } } | null)?.tak?.uid === uid,
});

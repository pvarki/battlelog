import type { CreateEventInput } from "../events/events.service.ts";
import { EVENT_TYPE, INPUT_SOURCE } from "../ingest/ingest.types.ts";
import type { CotEvent } from "./tak.cot.ts";

/** Headers are one line in a list; the untruncated text stays in `data`. */
const HEADER_MAX_CHARS = 200;

const truncate = (text: string): string =>
  text.length > HEADER_MAX_CHARS ? `${text.slice(0, HEADER_MAX_CHARS - 1)}…` : text;

/**
 * ATAK sends lat=0 lon=0 to mean "no position". Stored as a point it would drop
 * every such event into the Gulf of Guinea on any map widget.
 */
const pointOf = (cot: CotEvent): [number, number] | null => {
  const { lat, lon } = cot;
  if (lat === undefined || lon === undefined) return null;
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
};

/** Who sent it, as far as the CoT tells us. */
const author = (cot: CotEvent): string => cot.senderCallsign ?? cot.callsign ?? cot.uid;

const tagsOf = (cot: CotEvent, isChat: boolean): string[] => {
  const tags = ["tak", cot.type];
  if (isChat) tags.push("chat");
  if (cot.chatRoom) tags.push(cot.chatRoom);
  return tags;
};

/**
 * One CoT event as a feed entry.
 *
 * `createdBy` is namespaced `tak:<callsign>` rather than bare. Everywhere else in
 * this app createdBy is a person — the CN of their client certificate — and both
 * the events filter and the feed widget already filter on it, so `tak:ALPHA-1`
 * gives "everything Alpha-1 sent" for free. The prefix is also what stops a TAK
 * client from claiming a BattleLog user's identity by picking their callsign.
 */
export const cotToCreateInput = (cot: CotEvent, ingestSourceId?: string): CreateEventInput => {
  const isChat = Boolean(cot.chatRoom || cot.remarks);
  const body = cot.remarks?.trim();
  return {
    createdBy: `tak:${author(cot)}`,
    updatedBy: null,
    // header is NOT NULL, and plenty of CoT carries no text at all (position
    // reports, delivery receipts), so there has to be a real fallback.
    header: body ? truncate(body) : `${author(cot)} — ${cot.type}`,
    // Three clocks stay distinct: eventTime is when the sender says it happened,
    // createdAt (DB default) is when we ingested it.
    eventTime: cot.time ?? cot.start ?? null,
    tags: tagsOf(cot, isChat),
    hcoeDomains: null,
    // Not rated. Any constant here would be a claim about source reliability
    // that nothing in the CoT supports; the UI renders null as "not rated".
    admiraltyReliability: null,
    admiraltyAccuracy: null,
    location: null,
    locationPoint: pointOf(cot),
    inputSource: INPUT_SOURCE.tak,
    ingestSourceId: ingestSourceId ?? null,
    // Synthetic and not dereferenceable, but stable and unique: it is the key
    // back to the upstream message when someone asks where an entry came from.
    sourceUri: `tak://${cot.uid}${cot.time ? `/${cot.time.toISOString()}` : ""}`,
    type: isChat ? EVENT_TYPE.takChat : EVENT_TYPE.takCot,
    data: {
      uid: cot.uid,
      cotType: cot.type,
      how: cot.how ?? null,
      callsign: cot.callsign ?? null,
      chatRoom: cot.chatRoom ?? null,
      senderCallsign: cot.senderCallsign ?? null,
      destCallsign: cot.destCallsign ?? null,
      remarks: body ?? null,
      hae: cot.hae ?? null,
      staleTime: cot.stale?.toISOString() ?? null,
      detail: cot.detail ?? null,
    },
  };
};

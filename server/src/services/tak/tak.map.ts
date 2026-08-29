import { createHash } from "node:crypto";
import type { CreateEventInput } from "../events/events.service.ts";
import { EVENT_TYPE, INPUT_SOURCE } from "../ingest/ingest.types.ts";
import type { CotEvent } from "./tak.cot.ts";
import { describeCotType } from "./tak.symbol.ts";

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

/**
 * A marker's one-line description: who, what it is, and what was written on it.
 *
 * The remarks are appended rather than replacing the symbol, because on a marker
 * they are a note about a thing and lose their meaning without it.
 */
const takHeader = (cot: CotEvent, label: string, body?: string): string => {
  const who = subject(cot);
  const what = who === label ? label : `${who} — ${label}`;
  return truncate(body ? `${what}, Remarks: ${body}` : what);
};

/**
 * The key that decides whether we have seen this message before.
 *
 * It cannot include the event's `time`: TAK rewrites that attribute when it
 * relays, so the same message arriving twice on its re-send timer carried two
 * different times and produced two rows. Verified against TAK 5.8 — a replayed
 * event kept the `production_time` and `stale` we sent, but `time` had been
 * replaced with the relay clock.
 *
 * GeoChat gets `__chat messageId`, the one per-message id TAK relays unchanged.
 * Without one the time stays in the key and the message is not deduplicated:
 * better a possible duplicate than silently collapsing two identical reports
 * sent a minute apart.
 *
 * Everything else is keyed on uid plus a digest of what the report says (type,
 * position, detail). An unchanged re-send collapses; a unit that has moved, or
 * a marker someone edited, is a new row — which is what a log of a moving
 * picture has to do.
 */
/**
 * Detail with TAK's own relay bookkeeping removed.
 *
 * TAK appends `<_flow-tags_ TAK-Server-<id>="<relay time>"/>` on every hop, so
 * the detail of an unchanged, re-sent report differs on each arrival. Hashing
 * it verbatim meant the digest changed every time and nothing deduplicated —
 * which is what the first attempt at this got wrong. The tag is TAK's, not the
 * producer's, so it carries nothing about what was reported.
 */
const withoutRelayStamps = (detail: string | undefined): string =>
  (detail ?? "").replace(/<_flow-tags_\b[^>]*\/>/g, "");

const sourceUriOf = (cot: CotEvent, isChat: boolean): string => {
  if (isChat) {
    return cot.messageId
      ? `tak://chat/${cot.messageId}`
      : `tak://${cot.uid}${cot.time ? `/${cot.time.toISOString()}` : ""}`;
  }
  const digest = createHash("sha256")
    .update(
      `${cot.type}\n${cot.lat ?? ""},${cot.lon ?? ""},${cot.hae ?? ""}\n${withoutRelayStamps(cot.detail)}`,
    )
    .digest("hex")
    .slice(0, 16);
  return `tak://${cot.uid}/${digest}`;
};

/**
 * Who reported it.
 *
 * On a marker this is NOT <contact callsign>: that names the thing the marker is
 * about — an enemy platoon, a hazard — and attributing the entry to it would
 * credit the sighting to whatever was sighted. ATAK names the operator who
 * placed the marker in <link parent_callsign>, so that wins. A position report
 * has no such link and is its own author, which is where the contact callsign
 * still applies.
 */
const author = (cot: CotEvent): string =>
  cot.senderCallsign ?? cot.parentCallsign ?? cot.callsign ?? cot.uid;

/** What the entry is about: the marker's own label, or a client reporting itself. */
const subject = (cot: CotEvent): string => cot.senderCallsign ?? cot.callsign ?? cot.uid;

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
  // A <__chat> element is what makes a message a message. Remarks alone do not:
  // an operator's note on a unit marker is an annotation of that unit, and
  // calling it chat would file the marker under the wrong type.
  const isChat = cot.chatRoom !== undefined || cot.senderCallsign !== undefined;
  const body = cot.remarks?.trim();
  const label = describeCotType(cot.type);
  return {
    createdBy: `tak:${author(cot)}`,
    updatedBy: null,
    // header is NOT NULL, and plenty of CoT carries no text at all (position
    // reports, delivery receipts), so there has to be a real fallback. For a
    // marker the fallback is the decoded symbol rather than the raw type code:
    // "Hostile, Ground, Infantry" is what an operator can act on, a-h-G-U-C-I
    // is not.
    header: isChat && body ? truncate(body) : takHeader(cot, label, body),
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
    sourceUri: sourceUriOf(cot, isChat),
    type: isChat ? EVENT_TYPE.takChat : EVENT_TYPE.takCot,
    data: {
      uid: cot.uid,
      cotType: cot.type,
      // The decoded symbol, so a feed column can show it without the raw code.
      cotTypeLabel: label,
      how: cot.how ?? null,
      callsign: cot.callsign ?? null,
      chatRoom: cot.chatRoom ?? null,
      senderCallsign: cot.senderCallsign ?? null,
      parentCallsign: cot.parentCallsign ?? null,
      destCallsign: cot.destCallsign ?? null,
      remarks: body ?? null,
      hae: cot.hae ?? null,
      staleTime: cot.stale?.toISOString() ?? null,
      detail: cot.detail ?? null,
    },
  };
};

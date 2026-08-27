import { XMLParser } from "fast-xml-parser";

/**
 * Cursor-on-Target parsing. CoT is XML on the wire: one <event> element per
 * message, with a <point> and a free-form <detail> subtree whose contents depend
 * on what sent it.
 *
 * Only the fields we actually use are lifted out. The raw <detail> XML is kept
 * verbatim alongside them, because that is what an operator greps to work out
 * what to filter on — TAK has no server-side notion of, say, a client's role, so
 * the only way to select on one is a substring of this string.
 */

/** One parsed CoT event. Every lifted field is optional: CoT producers vary. */
export type CotEvent = {
  uid: string;
  type: string;
  /** When the sender says it happened. */
  time?: Date;
  /** Start of validity, used as a fallback for {@link time}. */
  start?: Date;
  stale?: Date;
  how?: string;
  lat?: number;
  lon?: number;
  hae?: number;
  /** Raw <detail>...</detail> XML, or undefined when the event carries none. */
  detail?: string;
  /** <contact callsign="..."> — who sent it. */
  callsign?: string;
  /** <__chat chatroom="..."> — the GeoChat room, ie the "feed". */
  chatRoom?: string;
  /** <__chat senderCallsign="...">, which need not equal {@link callsign}. */
  senderCallsign?: string;
  /**
   * <link parent_callsign="..."> — the operator who placed this, which on a
   * marker is a different person from {@link callsign}: that one names the thing
   * the marker is about ("VIHOLLINEN-1"), not who reported it.
   */
  parentCallsign?: string;
  /** <__chat><chatgrp to="..."> or the chat id — who it was addressed to. */
  destCallsign?: string;
  /** <remarks> text, which is the actual chat message body. */
  remarks?: string;
};

/**
 * A CoT stream is a bare sequence of <event> elements with no framing beyond the
 * closing tag, so that is what we split on. Returns whole events plus whatever
 * is left mid-element for the next chunk.
 */
export const extractCotEvents = (buffer: string): { events: string[]; remaining: string } => {
  const events: string[] = [];
  const closing = "</event>";
  let rest = buffer;
  for (;;) {
    const end = rest.indexOf(closing);
    if (end === -1) break;
    const chunk = rest.slice(0, end + closing.length);
    rest = rest.slice(end + closing.length);
    const start = chunk.indexOf("<event");
    // Anything before the first <event> is junk (a partial from a reconnect, or
    // the XML declaration TAK sometimes prepends) and is dropped with the split.
    if (start !== -1) events.push(chunk.slice(start));
  }
  // Nothing looks like an event yet and the buffer is getting long: a peer that
  // never closes an element must not grow this without bound.
  if (rest.length > 1_000_000) return { events, remaining: "" };
  return { events, remaining: rest };
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // <detail> children are what we read; keep the raw text of leaves like <remarks>
  textNodeName: "#text",
  parseAttributeValue: false,
  trimValues: true,
});

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** First match if the parser gave us an array (repeated element), else the value. */
const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

const str = (value: unknown): string | undefined => {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
};

const num = (value: unknown): number | undefined => {
  const text = str(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const date = (value: unknown): Date | undefined => {
  const text = str(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** Text of an element that may be a bare string or an object with a text node. */
const elementText = (value: unknown): string | undefined => {
  const one = first(value);
  if (typeof one === "string") return one.trim() || undefined;
  const record = asRecord(one);
  return record ? str(record["#text"]) : undefined;
};

/** The raw <detail> XML, sliced out of the source rather than re-serialised. */
const rawDetail = (xml: string): string | undefined => {
  const open = xml.indexOf("<detail");
  if (open === -1) return undefined;
  const close = xml.indexOf("</detail>", open);
  if (close !== -1) return xml.slice(open, close + "</detail>".length);
  // Self-closing <detail/>: nothing worth keeping.
  return undefined;
};

/**
 * Parse one <event> element. Returns undefined for anything that is not a usable
 * CoT event, so a malformed message on the stream is skipped rather than fatal.
 */
export const parseCotEvent = (xml: string): CotEvent | undefined => {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return undefined;
  }
  const event = asRecord(first(asRecord(parsed)?.event));
  if (!event) return undefined;
  const uid = str(event["@uid"]);
  const type = str(event["@type"]);
  if (!uid || !type) return undefined;

  const point = asRecord(first(event.point));
  const detail = asRecord(first(event.detail));
  const contact = asRecord(first(detail?.contact));
  const chat = asRecord(first(detail?.__chat));
  const chatgrp = asRecord(first(chat?.chatgrp));
  // A detail can carry several <link>s (a route is all links), and only the
  // producer link names its author, so pick by the attribute rather than by
  // position.
  const links = [detail?.link ?? []].flat();
  const producer = links.map(asRecord).find((link) => link?.["@parent_callsign"] !== undefined);

  return {
    uid,
    type,
    time: date(event["@time"]),
    start: date(event["@start"]),
    stale: date(event["@stale"]),
    how: str(event["@how"]),
    lat: num(point?.["@lat"]),
    lon: num(point?.["@lon"]),
    hae: num(point?.["@hae"]),
    detail: rawDetail(xml),
    callsign: str(contact?.["@callsign"]),
    chatRoom: str(chat?.["@chatroom"]),
    senderCallsign: str(chat?.["@senderCallsign"]),
    parentCallsign: str(producer?.["@parent_callsign"]),
    destCallsign: str(chatgrp?.["@to"]) ?? str(chat?.["@id"]),
    remarks: elementText(detail?.remarks),
  };
};

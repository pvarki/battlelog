import type { CreateEventInput } from "../events/events.service.ts";
import { EVENT_TYPE, INPUT_SOURCE } from "../ingest/ingest.types.ts";
import type { MatrixTimelineEvent } from "./matrix.client.ts";

/** Headers are one line in a list; the untruncated body stays in `data`. */
const HEADER_MAX_CHARS = 200;

const toHeader = (body: string): string => {
  const line = (body.split("\n", 1)[0] ?? "").replace(/\s+/g, " ").trim();
  return line.length > HEADER_MAX_CHARS ? `${line.slice(0, HEADER_MAX_CHARS - 1)}…` : line;
};

/**
 * MXID to RM callsign. The localpart *is* the callsign — matrixrmapi builds
 * MXIDs from it and Synapse's OIDC mapping uses the same value — so no lookup
 * table is needed.
 *
 * Only our own homeserver's domain is stripped. A federated sender keeps their
 * full MXID, otherwise `@alpha1:evil.example` would land in `created_by` as
 * plain `alpha1` and read as one of our own users.
 */
export const senderIdentity = (mxid: string, serverDomain: string): string =>
  mxid.startsWith("@") && mxid.endsWith(`:${serverDomain}`)
    ? mxid.slice(1, -(serverDomain.length + 1))
    : mxid;

/** `geo:60.1699,24.9384;u=25` to `[lng, lat]`, drizzle's geometry tuple order. */
export const parseGeoUri = (uri: string): [number, number] | null => {
  const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(uri);
  const latText = match?.[1];
  const lngText = match?.[2];
  if (!latText || !lngText) return null;
  const lat = Number(latText);
  const lng = Number(lngText);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
};

/**
 * One Matrix message as a feed entry, or null when there is nothing to log:
 * not a message, redacted (redaction strips content, so an empty body is how a
 * redacted event arrives), or a body that is only whitespace.
 */
export const matrixEventToCreateInput = (
  ev: MatrixTimelineEvent,
  ctx: { roomId: string; roomName?: string; serverDomain: string; ingestSourceId?: string },
): CreateEventInput | null => {
  if (ev.type !== "m.room.message") return null;
  const { event_id: eventId, sender, origin_server_ts: ts, content } = ev;
  if (!eventId || !sender || !content) return null;
  const body = typeof content.body === "string" ? content.body : "";
  const header = toHeader(body);
  if (!header) return null;
  const msgtype = typeof content.msgtype === "string" ? content.msgtype : null;
  const point = typeof content.geo_uri === "string" ? parseGeoUri(content.geo_uri) : null;
  const tags = ["matrix"];
  if (ctx.roomName) tags.push(ctx.roomName);
  return {
    createdBy: senderIdentity(sender, ctx.serverDomain),
    updatedBy: null,
    eventTime: typeof ts === "number" ? new Date(ts) : null,
    header,
    tags,
    hcoeDomains: null,
    // Chat carries no source rating; the UI renders null as "not rated" and an
    // operator can rate an entry afterwards.
    admiraltyReliability: null,
    admiraltyAccuracy: null,
    location: null,
    locationPoint: point,
    inputSource: INPUT_SOURCE.matrix,
    ingestSourceId: ctx.ingestSourceId ?? null,
    // A permalink, so "where did this come from" opens in the reader's own
    // Matrix client. Unique per event, which also makes it the dedup key.
    sourceUri: `https://matrix.to/#/${encodeURIComponent(ctx.roomId)}/${encodeURIComponent(
      eventId,
    )}?via=${ctx.serverDomain}`,
    type: EVENT_TYPE.matrixMessage,
    data: {
      eventId,
      roomId: ctx.roomId,
      roomName: ctx.roomName ?? null,
      sender,
      msgtype,
      body,
    },
  };
};

import type { IngestSourceRow } from "../../db/schema.ts";
import type { TakSourceConfig } from "../ingest/ingest.types.ts";
import type { CotEvent } from "./tak.cot.ts";

/**
 * Deciding which configured source, if any, wants a given CoT event.
 *
 * Pure on purpose: this is the whole of the selection logic, so it is the part
 * worth testing, and it must be cheap enough to run per event on a live stream.
 */

const list = (value: string[] | undefined): string[] =>
  (value ?? []).map((item) => item.trim()).filter(Boolean);

/** No constraint set means no constraint applied — an empty list matches anything. */
const matchesExact = (candidate: string | undefined, allowed: string[]): boolean => {
  if (!allowed.length) return true;
  return candidate !== undefined && allowed.includes(candidate);
};

const matchesPrefix = (candidate: string | undefined, prefixes: string[]): boolean => {
  if (!prefixes.length) return true;
  return candidate !== undefined && prefixes.some((prefix) => candidate.startsWith(prefix));
};

const matchesSubstring = (candidate: string | undefined, needles: string[]): boolean => {
  if (!needles.length) return true;
  return candidate !== undefined && needles.some((needle) => candidate.includes(needle));
};

/** True when every constraint this config sets is satisfied. */
export const matchesTakConfig = (cot: CotEvent, config: TakSourceConfig): boolean =>
  matchesPrefix(cot.type, list(config.cotTypes)) &&
  matchesExact(cot.chatRoom, list(config.chatRooms)) &&
  matchesExact(cot.destCallsign, list(config.destCallsigns)) &&
  matchesExact(cot.senderCallsign ?? cot.callsign, list(config.senderCallsigns)) &&
  matchesSubstring(cot.detail, list(config.detailContains));

/**
 * First source that wants this event, or undefined for none.
 *
 * First rather than all: one CoT event becomes at most one feed entry. Two
 * overlapping sources would otherwise duplicate everything they share, which is
 * never what someone setting up a second filter meant.
 */
export const matchTakSource = (
  cot: CotEvent,
  sources: IngestSourceRow[],
): IngestSourceRow | undefined =>
  sources.find((source) => matchesTakConfig(cot, source.config as TakSourceConfig));

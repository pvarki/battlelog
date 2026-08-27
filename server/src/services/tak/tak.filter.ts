import type { IngestSourceRow } from "../../db/schema.ts";
import { logger } from "../../lib/logger.ts";
import type { TakSourceConfig } from "../ingest/ingest.types.ts";
import type { CotEvent } from "./tak.cot.ts";

/**
 * Deciding which configured setup, if any, wants a given CoT event.
 *
 * Every field is a list of regular expressions, matched unanchored — one rule
 * for all of them rather than the prefix-here-exact-there mix this started as,
 * because a setup exists to express one search and the operator should not have
 * to remember which field means which kind of match. Anchor with ^ and $ for an
 * exact match; `a-f-` still behaves like a prefix in practice.
 *
 * Pure and cheap on purpose: this runs per CoT event on a live stream.
 */

/** Compiled patterns, keyed by the pattern text. Bounded by how many a setup has. */
const cache = new Map<string, RegExp | null>();

/**
 * Compile once and remember. A pattern that does not compile yields null and is
 * treated as matching nothing — the API validates patterns on save, so this only
 * catches rows written before that validation existed.
 *
 * ponytail: a catastrophically backtracking pattern will stall the ingest loop,
 * since these run on the event loop against remote-supplied text. Authoring a
 * pattern is admin-only and an admin can stop the ingest outright, so the
 * exposure is the same either way; if patterns ever become a non-admin setting,
 * this needs a timeout — a worker thread or a linear-time engine like re2.
 */
const compile = (pattern: string): RegExp | null => {
  const hit = cache.get(pattern);
  if (hit !== undefined) return hit;
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(pattern);
  } catch (err) {
    logger.warn({ err, pattern }, "tak filter: ignoring an invalid regular expression");
  }
  cache.set(pattern, compiled);
  return compiled;
};

const patterns = (value: string[] | undefined): string[] =>
  (value ?? []).map((item) => item.trim()).filter(Boolean);

/** No patterns for a field means no constraint on it. */
const matches = (candidate: string | undefined, list: string[]): boolean => {
  if (!list.length) return true;
  if (candidate === undefined) return false;
  return list.some((pattern) => compile(pattern)?.test(candidate) ?? false);
};

/** True when every constraint this config sets is satisfied. */
export const matchesTakConfig = (cot: CotEvent, config: TakSourceConfig): boolean =>
  matches(cot.type, patterns(config.cotTypes)) &&
  matches(cot.chatRoom, patterns(config.chatRooms)) &&
  matches(cot.destCallsign, patterns(config.destCallsigns)) &&
  matches(cot.senderCallsign ?? cot.callsign, patterns(config.senderCallsigns)) &&
  matches(cot.detail, patterns(config.detailContains));

/**
 * First setup that wants this event, or undefined for none.
 *
 * First rather than all: one CoT event becomes at most one feed entry. Two
 * overlapping setups would otherwise duplicate everything they share, which is
 * never what someone adding a second filter meant. Order is the list order,
 * which the service sorts by name so it is stable and visible.
 */
export const matchTakSource = (
  cot: CotEvent,
  sources: IngestSourceRow[],
): IngestSourceRow | undefined =>
  sources.find((source) => matchesTakConfig(cot, source.config as TakSourceConfig));

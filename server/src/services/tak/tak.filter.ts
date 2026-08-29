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
 * ponytail: a catastrophically backtracking pattern can still stall the ingest
 * loop. Authoring a pattern is admin-only, but the text it runs against is not:
 * any client on the CoT stream supplies its own <detail>, so one compromised
 * handheld plus one careless pattern is a denial of service against the whole
 * deployment. MAX_CANDIDATE_CHARS bounds the per-event cost, which is a
 * mitigation and not a fix — the fix is a linear-time engine (re2) or matching
 * off the event loop with a timeout.
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

/**
 * Longest candidate a pattern is run against.
 *
 * Backtracking cost grows with the input, and the input here is remote: any
 * client on the CoT stream chooses its own <detail>, which is unbounded in
 * practice. Capping it turns "one crafted message stalls the event loop for
 * everyone" into a bounded cost per event. Real detail is a couple of hundred
 * bytes to a few KB, so this does not change what matches in practice — and a
 * pattern that only matches past 16KB of one element is not a filter anyone
 * wrote on purpose.
 */
const MAX_CANDIDATE_CHARS = 16_384;

/** No patterns for a field means no constraint on it. */
const matches = (candidate: string | undefined, list: string[]): boolean => {
  if (!list.length) return true;
  if (candidate === undefined) return false;
  const bounded =
    candidate.length > MAX_CANDIDATE_CHARS ? candidate.slice(0, MAX_CANDIDATE_CHARS) : candidate;
  return list.some((pattern) => compile(pattern)?.test(bounded) ?? false);
};

/** True when every constraint this config sets is satisfied. */
/**
 * True when any pattern matches — an exclusion, so an empty list excludes
 * nothing. The mirror image of {@link matches}, where an empty list constrains
 * nothing.
 */
const excludes = (candidate: string | undefined, list: string[]): boolean => {
  if (!list.length || candidate === undefined) return false;
  return list.some((pattern) => compile(pattern)?.test(candidate) ?? false);
};

export const matchesTakConfig = (cot: CotEvent, config: TakSourceConfig): boolean =>
  // Exclusions first: they overrule everything, which is what makes "this whole
  // feed except the position reports" expressible at all.
  !excludes(cot.type, patterns(config.excludeCotTypes)) &&
  matches(cot.type, patterns(config.cotTypes)) &&
  matches(cot.how, patterns(config.hows)) &&
  matches(cot.role, patterns(config.roles)) &&
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

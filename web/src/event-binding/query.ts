import { z } from "zod";
import type { FeedConfig } from "../widgets/feed/widget.ts";

const dataFilterSchema = z.object({
  id: z.string().min(1).max(64),
  path: z.string().max(200).default(""),
  value: z.string().max(200).default(""),
});

/** Which events a dynamic widget lists. Lenient strings: config forms persist mid-edit. */
export const eventQueryShape = {
  /** Comma-separated event types; required — an empty query would match every event. */
  types: z.string().max(200).default(""),
  tags: z.string().max(200).default(""),
  /** Exact-value matches on `data` (dot path → text), like the feed's data filters. */
  dataFilters: z.array(dataFilterSchema).max(10).default([]),
};
const eventQuerySchema = z.object(eventQueryShape);
export type EventQuery = z.infer<typeof eventQuerySchema>;

const csv = (v: string): string[] =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The query as the feed's filter config, so server query and live matching
 * are the feed's own. Undefined without a type: an empty filter would list
 * every event, and the server only accepts data filters alongside types.
 */
export const queryFilter = (query: EventQuery, rows = 100): FeedConfig | undefined => {
  const types = csv(query.types);
  if (types.length === 0) return undefined;
  const tags = csv(query.tags);
  return {
    types,
    ...(tags.length ? { tags } : {}),
    dataFilters: query.dataFilters,
    rows,
    columns: [],
  };
};

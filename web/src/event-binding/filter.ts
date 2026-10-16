import type { InferRequestType } from "hono/client";
import { z } from "zod";
import type { api, EventResponse } from "../api.ts";

type EventsQuery = InferRequestType<typeof api.events.$get>["query"];

const dataFilterSchema = z
  .object({
    id: z.string().min(1).max(64),
    /** Dot path into `data`, like a data column's. */
    path: z.string().max(200).default(""),
    value: z.string().max(200).default(""),
  })
  .strict();

export type DataFilter = z.infer<typeof dataFilterSchema>;

/** Which events to list. The feed widget persists it inside its strict config. */
export const eventFilterShape = {
  types: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  /** Header substring, case-insensitive. */
  search: z.string().optional(),
  createdBy: z.string().optional(),
  /** Exact-value matches on `data`; only applied while `types` is set (the server requires it). */
  dataFilters: z.array(dataFilterSchema).max(10).optional(),
};
const eventFilterSchema = z.object(eventFilterShape);
export type EventFilter = z.infer<typeof eventFilterSchema>;

/**
 * Ephemeral fullscreen filters. They only ever narrow: config filters stay
 * locked, extras AND on top. Dates are datetime-local strings.
 */
export type FilterExtras = {
  types?: string[];
  tags?: string[];
  search?: string;
  createdBy?: string;
  eventTimeFrom?: string;
  eventTimeTo?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
};

/** Scalar at a dot path in the event's `data` jsonb; "" when missing or non-scalar. */
export const dataValue = (data: unknown, path: string): string => {
  let v: unknown = data;
  for (const key of path.split(".")) {
    if (v === null || typeof v !== "object") return "";
    v = (v as Record<string, unknown>)[key];
  }
  return v == null || typeof v === "object" ? "" : String(v);
};

/** Path → value of the data filters in effect: none without types, and half-typed rows skipped. */
export const activeDataFilters = (filter: EventFilter): Record<string, string> | undefined => {
  if (!filter.types?.length) return undefined;
  const complete = (filter.dataFilters ?? []).filter((f) => f.path.trim() && f.value);
  if (!complete.length) return undefined;
  return Object.fromEntries(complete.map((f) => [f.path.trim(), f.value]));
};

/**
 * Server-side query for the initial batch (limit is added by the hook).
 * The filter wins where both could apply — extras only narrow, so the
 * server result is a superset and {@link matchesFeed} does the exact cut.
 * Time ranges exist only in extras and pass straight through.
 */
// Cast like the explorer's buildQuery: dates travel as datetime-local strings.
export const queryFor = (filter: EventFilter, extras?: FilterExtras): EventsQuery => {
  const data = activeDataFilters(filter);
  return {
    ...(filter.types?.length ? { types: filter.types.join(",") } : {}),
    ...(filter.tags?.length ? { tags: filter.tags.join(",") } : {}),
    ...(filter.search || extras?.search ? { search: filter.search || extras?.search } : {}),
    ...(filter.createdBy || extras?.createdBy
      ? { createdBy: filter.createdBy || extras?.createdBy }
      : {}),
    ...(extras?.eventTimeFrom ? { eventTimeFrom: extras.eventTimeFrom } : {}),
    ...(extras?.eventTimeTo ? { eventTimeTo: extras.eventTimeTo } : {}),
    ...(extras?.createdAtFrom ? { createdAtFrom: extras.createdAtFrom } : {}),
    ...(extras?.createdAtTo ? { createdAtTo: extras.createdAtTo } : {}),
    ...(data ? { data: JSON.stringify(data) } : {}),
  } as EventsQuery;
};

const inRange = (value: string | null, from?: string, to?: string): boolean => {
  if (!from && !to) return true;
  if (value === null) return false;
  const t = Date.parse(value);
  if (from && t < Date.parse(from)) return false;
  if (to && t > Date.parse(to)) return false;
  return true;
};

/** Client-side mirror of the full filter for rows from the shared stream. */
export const matchesFeed = (
  row: EventResponse,
  filter: EventFilter,
  extras?: FilterExtras,
): boolean => {
  if (filter.types?.length && (row.type === null || !filter.types.includes(row.type))) return false;
  if (filter.tags?.length && !filter.tags.some((t) => row.tags?.includes(t))) return false;
  if (filter.search && !row.header.toLowerCase().includes(filter.search.toLowerCase()))
    return false;
  if (filter.createdBy && row.createdBy !== filter.createdBy) return false;
  for (const [path, value] of Object.entries(activeDataFilters(filter) ?? {})) {
    if (dataValue(row.data, path) !== value) return false;
  }
  if (!extras) return true;
  if (extras.types?.length && (row.type === null || !extras.types.includes(row.type))) return false;
  if (extras.tags?.length && !extras.tags.some((t) => row.tags?.includes(t))) return false;
  if (extras.search && !row.header.toLowerCase().includes(extras.search.toLowerCase()))
    return false;
  if (extras.createdBy && row.createdBy !== extras.createdBy) return false;
  if (!inRange(row.eventTime, extras.eventTimeFrom, extras.eventTimeTo)) return false;
  if (!inRange(row.createdAt, extras.createdAtFrom, extras.createdAtTo)) return false;
  return true;
};

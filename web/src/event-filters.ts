import type { InferRequestType } from "hono/client";
import { z } from "zod";
import type { api } from "./api.ts";

export const PAGE = 100;

export const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

/** The filter form's working shape: every field present, empty means unset. */
export type Filters = {
  search: string;
  types: string[];
  tags: string[];
  hcoeDomains: string[];
  reliabilities: string[];
  credibilities: string[];
  createdBy: string;
  eventId: string;
  eventTimeFrom: string;
  eventTimeTo: string;
  createdAtFrom: string;
  createdAtTo: string;
  lat: number | string;
  lng: number | string;
  radiusMeters: number | string;
  includeHistory: boolean;
};

export const EMPTY: Filters = {
  search: "",
  types: [],
  tags: [],
  hcoeDomains: [],
  reliabilities: [],
  credibilities: [],
  createdBy: "",
  eventId: "",
  eventTimeFrom: "",
  eventTimeTo: "",
  createdAtFrom: "",
  createdAtTo: "",
  lat: "",
  lng: "",
  radiusMeters: "",
  includeHistory: false,
};

// Applied filters live in the URL as search params: only non-empty fields,
// so links stay short. A malformed URL degrades to no filters via .catch.
const searchSchema = z
  .object({
    search: z.string(),
    types: z.string().array(),
    tags: z.string().array(),
    hcoeDomains: z.string().array(),
    reliabilities: z.string().array(),
    credibilities: z.string().array(),
    createdBy: z.string(),
    eventId: z.string(),
    eventTimeFrom: z.string(),
    eventTimeTo: z.string(),
    createdAtFrom: z.string(),
    createdAtTo: z.string(),
    lat: z.union([z.number(), z.string()]),
    lng: z.union([z.number(), z.string()]),
    radiusMeters: z.union([z.number(), z.string()]),
    includeHistory: z.boolean(),
  })
  .partial();

/** Filters as they exist in the URL — the source of truth for what is applied. */
export type Applied = z.infer<typeof searchSchema>;

export const validateEventSearch = (search: unknown) => searchSchema.catch({}).parse(search);

export const compact = (f: Filters): Applied =>
  Object.fromEntries(
    Object.entries(f).filter(
      ([, v]) => v !== "" && v !== false && !(Array.isArray(v) && v.length === 0),
    ),
  ) as Applied;

type EventsQuery = InferRequestType<typeof api.events.$get>["query"];

export const buildQuery = (f: Filters): EventsQuery => {
  const geoComplete = f.lat !== "" && f.lng !== "" && f.radiusMeters !== "";
  return {
    ...(f.search.trim() ? { search: f.search.trim() } : {}),
    ...(f.types.length ? { types: f.types.join(",") } : {}),
    ...(f.tags.length ? { tags: f.tags.join(",") } : {}),
    ...(f.hcoeDomains.length ? { hcoeDomains: f.hcoeDomains.join(",") } : {}),
    ...(f.reliabilities.length ? { reliabilities: f.reliabilities.join(",") } : {}),
    ...(f.credibilities.length ? { credibilities: f.credibilities.join(",") } : {}),
    ...(f.createdBy.trim() ? { createdBy: f.createdBy.trim() } : {}),
    ...(isUuid(f.eventId.trim()) ? { eventId: f.eventId.trim() } : {}),
    ...(f.eventTimeFrom ? { eventTimeFrom: f.eventTimeFrom } : {}),
    ...(f.eventTimeTo ? { eventTimeTo: f.eventTimeTo } : {}),
    ...(f.createdAtFrom ? { createdAtFrom: f.createdAtFrom } : {}),
    ...(f.createdAtTo ? { createdAtTo: f.createdAtTo } : {}),
    ...(geoComplete
      ? { lat: String(f.lat), lng: String(f.lng), radiusMeters: String(f.radiusMeters) }
      : {}),
    ...(f.includeHistory ? { includeHistory: "true" as const } : {}),
    limit: PAGE,
  } as EventsQuery;
};

const TEXT_LABEL = { search: "Search", createdBy: "By", eventId: "Event" } as const;
const LIST_LABEL = {
  types: "Type",
  tags: "Tag",
  hcoeDomains: "Domain",
  reliabilities: "Reliability",
  credibilities: "Credibility",
} as const;
const TIME_LABEL = {
  eventTimeFrom: "Event from",
  eventTimeTo: "Event to",
  createdAtFrom: "Logged from",
  createdAtTo: "Logged to",
} as const;

export type FilterChip = {
  /** Stable key, also identifies the search chip so the header can exclude it. */
  id: string;
  label: string;
  /** The applied set with this chip's contribution removed. */
  without: Applied;
};

const omit = (applied: Applied, keys: (keyof Applied)[]): Applied => {
  const next = { ...applied };
  for (const key of keys) delete next[key];
  return next;
};

/**
 * One removable chip per applied filter, so the narrowing is readable at a
 * glance and reversible in one click. List filters get a chip per value;
 * lat/lng/radius only filter as a complete triple (see queryToFilter on the
 * server), so they travel as a single chip.
 */
export const activeChips = (applied: Applied): FilterChip[] => {
  const chips: FilterChip[] = [];

  for (const key of ["search", "createdBy", "eventId"] as const) {
    const value = applied[key];
    if (value) {
      chips.push({
        id: key,
        label: `${TEXT_LABEL[key]}: ${value}`,
        without: omit(applied, [key]),
      });
    }
  }

  for (const key of ["types", "tags", "hcoeDomains", "reliabilities", "credibilities"] as const) {
    for (const value of applied[key] ?? []) {
      const rest = (applied[key] ?? []).filter((v) => v !== value);
      chips.push({
        id: `${key}:${value}`,
        label: `${LIST_LABEL[key]}: ${value}`,
        without: rest.length ? { ...applied, [key]: rest } : omit(applied, [key]),
      });
    }
  }

  for (const key of ["eventTimeFrom", "eventTimeTo", "createdAtFrom", "createdAtTo"] as const) {
    const value = applied[key];
    if (value) {
      chips.push({
        id: key,
        label: `${TIME_LABEL[key]}: ${value.replace("T", " ")}`,
        without: omit(applied, [key]),
      });
    }
  }

  const { lat, lng, radiusMeters } = applied;
  if (lat !== undefined && lng !== undefined && radiusMeters !== undefined) {
    chips.push({
      id: "geo",
      label: `Within ${radiusMeters} m of ${lat}, ${lng}`,
      without: omit(applied, ["lat", "lng", "radiusMeters"]),
    });
  }

  if (applied.includeHistory) {
    chips.push({
      id: "includeHistory",
      label: "All versions",
      without: omit(applied, ["includeHistory"]),
    });
  }

  return chips;
};

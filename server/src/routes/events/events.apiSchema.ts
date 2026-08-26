import { z } from "@hono/zod-openapi";
import type { EventRow } from "../../db/schema.ts";
import { admiraltyCredibilityEnum, admiraltyReliabilityEnum } from "../../db/schema.ts";
import type { EventsFilter } from "../../services/events/events.filter.ts";
import type { CreateEventInput, UpdateEventPatch } from "../../services/events/events.service.ts";

const latLng = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .openapi("LatLng");

const eventFieldsSchema = z.object({
  header: z.string().min(1),
  eventTime: z.string().datetime().nullish(),
  tags: z.array(z.string()).nullish(),
  hcoeDomains: z.array(z.string()).nullish(),
  admiraltyReliability: z.enum(admiraltyReliabilityEnum.enumValues).nullish(),
  admiraltyAccuracy: z.enum(admiraltyCredibilityEnum.enumValues).nullish(),
  location: z.string().nullish(),
  locationPoint: latLng.nullish(),
  inputSource: z.string().nullish(),
  sourceUri: z.string().nullish(),
  type: z.string().nullish(),
  data: z.unknown().nullish(),
});

export const createEventRequestSchema = eventFieldsSchema.openapi("CreateEventRequest");
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

export const updateEventRequestSchema = eventFieldsSchema.partial().openapi("UpdateEventRequest");
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;

export const eventResponseSchema = z
  .object({
    id: z.string().uuid(),
    eventId: z.string().uuid(),
    createdBy: z.string(),
    updatedBy: z.string().nullable(),
    createdAt: z.string().datetime(),
    header: z.string(),
    eventTime: z.string().datetime().nullable(),
    tags: z.array(z.string()).nullable(),
    hcoeDomains: z.array(z.string()).nullable(),
    admiraltyReliability: z.enum(admiraltyReliabilityEnum.enumValues).nullable(),
    admiraltyAccuracy: z.enum(admiraltyCredibilityEnum.enumValues).nullable(),
    location: z.string().nullable(),
    locationPoint: latLng.nullable(),
    inputSource: z.string().nullable(),
    /** Set by an ingester; identifies the setup that produced the event. */
    ingestSourceId: z.string().uuid().nullable(),
    sourceUri: z.string().nullable(),
    type: z.string().nullable(),
    // z.any (not z.unknown): unknown fails Hono's JSONValue constraint and
    // collapses typed responses to never.
    data: z.any().nullable(),
  })
  .openapi("Event");
export type EventResponse = z.infer<typeof eventResponseSchema>;

export const errorResponseSchema = z.object({ error: z.string() }).openapi("ErrorResponse");

/** Comma-separated list query param, validated per-item after splitting. */
const csvParam = <T extends z.ZodTypeAny>(item: T) =>
  z
    .string()
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).min(1))
    .optional();

export const eventsQuerySchema = z.object({
  eventId: z.string().uuid().optional(),
  search: z.string().min(1).optional(),
  tags: csvParam(z.string()),
  hcoeDomains: csvParam(z.string()),
  types: csvParam(z.string()),
  ingestSources: csvParam(z.string().uuid()),
  dataKey: z.string().min(1).optional(),
  dataValue: z.string().optional(),
  reliabilities: csvParam(z.enum(admiraltyReliabilityEnum.enumValues)),
  credibilities: csvParam(z.enum(admiraltyCredibilityEnum.enumValues)),
  createdBy: z.string().optional(),
  eventTimeFrom: z.coerce.date().optional(),
  eventTimeTo: z.coerce.date().optional(),
  createdAtFrom: z.coerce.date().optional(),
  createdAtTo: z.coerce.date().optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  radiusMeters: z.coerce.number().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  /** Keyset pagination: pass the previous page's last id to get older rows. Ignores offset. */
  cursor: z.string().uuid().optional(),
  includeHistory: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

/** Geo params only take effect when all three of lng/lat/radiusMeters are present. */
export const queryToFilter = ({ lng, lat, radiusMeters, ...rest }: EventsQuery): EventsFilter => ({
  ...rest,
  location:
    lng !== undefined && lat !== undefined && radiusMeters !== undefined
      ? { lng, lat, radiusMeters }
      : undefined,
});

export const toCreateInput = (api: CreateEventRequest, createdBy: string): CreateEventInput => ({
  createdBy,
  updatedBy: null,
  header: api.header,
  eventTime: api.eventTime ? new Date(api.eventTime) : null,
  tags: api.tags ?? null,
  hcoeDomains: api.hcoeDomains ?? null,
  admiraltyReliability: api.admiraltyReliability ?? null,
  admiraltyAccuracy: api.admiraltyAccuracy ?? null,
  location: api.location ?? null,
  locationPoint: api.locationPoint ? [api.locationPoint.lng, api.locationPoint.lat] : null,
  inputSource: api.inputSource ?? null,
  sourceUri: api.sourceUri ?? null,
  type: api.type ?? null,
  data: api.data ?? null,
});

/** Fields copied into the patch as-is (absent = keep, null = clear). */
export const PASSTHROUGH_NULLABLE = [
  "tags",
  "hcoeDomains",
  "admiraltyReliability",
  "admiraltyAccuracy",
  "location",
  "inputSource",
  "sourceUri",
  "type",
  "data",
] as const;

export const toUpdatePatch = (api: UpdateEventRequest): UpdateEventPatch => {
  const patch: UpdateEventPatch = {};
  if (api.header !== undefined) patch.header = api.header;
  if (api.eventTime !== undefined) patch.eventTime = api.eventTime ? new Date(api.eventTime) : null;
  if (api.locationPoint !== undefined) {
    patch.locationPoint = api.locationPoint ? [api.locationPoint.lng, api.locationPoint.lat] : null;
  }
  for (const key of PASSTHROUGH_NULLABLE) {
    // cast: TS can't correlate api[key] with patch[key] across the key union
    if (api[key] !== undefined) patch[key] = (api[key] ?? null) as never;
  }
  return patch;
};

export const toApiEvent = (row: EventRow): EventResponse => ({
  id: row.id,
  eventId: row.eventId,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt.toISOString(),
  header: row.header,
  eventTime: row.eventTime?.toISOString() ?? null,
  tags: row.tags,
  hcoeDomains: row.hcoeDomains,
  admiraltyReliability: row.admiraltyReliability,
  admiraltyAccuracy: row.admiraltyAccuracy,
  location: row.location,
  locationPoint: row.locationPoint
    ? { lng: row.locationPoint[0], lat: row.locationPoint[1] }
    : null,
  inputSource: row.inputSource,
  ingestSourceId: row.ingestSourceId,
  sourceUri: row.sourceUri,
  type: row.type,
  data: row.data,
});

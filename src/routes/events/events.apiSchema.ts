import { z } from "@hono/zod-openapi";
import type { EventRow } from "../../db/schema.ts";
import { admiraltyCredibilityEnum, admiraltyReliabilityEnum } from "../../db/schema.ts";
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
    createdAt: z.string().datetime().nullable(),
    header: z.string(),
    eventTime: z.string().datetime().nullable(),
    tags: z.array(z.string()).nullable(),
    hcoeDomains: z.array(z.string()).nullable(),
    admiraltyReliability: z.enum(admiraltyReliabilityEnum.enumValues).nullable(),
    admiraltyAccuracy: z.enum(admiraltyCredibilityEnum.enumValues).nullable(),
    location: z.string().nullable(),
    locationPoint: latLng.nullable(),
    inputSource: z.string().nullable(),
    sourceUri: z.string().nullable(),
    type: z.string().nullable(),
    data: z.unknown().nullable(),
  })
  .openapi("Event");
export type EventResponse = z.infer<typeof eventResponseSchema>;

export const errorResponseSchema = z.object({ error: z.string() }).openapi("ErrorResponse");

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

export const toUpdatePatch = (api: UpdateEventRequest): UpdateEventPatch => {
  const patch: UpdateEventPatch = {};
  if (api.header !== undefined) patch.header = api.header;
  if (api.eventTime !== undefined) patch.eventTime = api.eventTime ? new Date(api.eventTime) : null;
  if (api.tags !== undefined) patch.tags = api.tags ?? null;
  if (api.hcoeDomains !== undefined) patch.hcoeDomains = api.hcoeDomains ?? null;
  if (api.admiraltyReliability !== undefined) {
    patch.admiraltyReliability = api.admiraltyReliability ?? null;
  }
  if (api.admiraltyAccuracy !== undefined) {
    patch.admiraltyAccuracy = api.admiraltyAccuracy ?? null;
  }
  if (api.location !== undefined) patch.location = api.location ?? null;
  if (api.locationPoint !== undefined) {
    patch.locationPoint = api.locationPoint ? [api.locationPoint.lng, api.locationPoint.lat] : null;
  }
  if (api.inputSource !== undefined) patch.inputSource = api.inputSource ?? null;
  if (api.sourceUri !== undefined) patch.sourceUri = api.sourceUri ?? null;
  if (api.type !== undefined) patch.type = api.type ?? null;
  if (api.data !== undefined) patch.data = api.data ?? null;
  return patch;
};

export const toApiEvent = (row: EventRow): EventResponse => ({
  id: row.id,
  eventId: row.eventId,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt?.toISOString() ?? null,
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
  sourceUri: row.sourceUri,
  type: row.type,
  data: row.data,
});

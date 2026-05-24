import type { SQL } from "drizzle-orm";
import { and, arrayOverlaps, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { EventRow } from "../../db/schema.js";
import { admiraltyCredibilityEnum, admiraltyReliabilityEnum, events } from "../../db/schema.js";

export const eventsFilterSchema = z.object({
  search: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  hcoeDomains: z.array(z.string()).optional(),
  types: z.array(z.string()).optional(),
  reliabilities: z.array(z.enum(admiraltyReliabilityEnum.enumValues)).optional(),
  credibilities: z.array(z.enum(admiraltyCredibilityEnum.enumValues)).optional(),
  createdBy: z.string().optional(),
  eventTimeFrom: z.coerce.date().optional(),
  eventTimeTo: z.coerce.date().optional(),
  createdAtFrom: z.coerce.date().optional(),
  createdAtTo: z.coerce.date().optional(),
  location: z
    .object({
      lng: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
      radiusMeters: z.number().positive(),
    })
    .optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  /** When false (default) list returns only current heads. */
  includeHistory: z.boolean().default(false),
});

export type EventsFilter = z.infer<typeof eventsFilterSchema>;

export const buildEventsWhere = (filter: EventsFilter): SQL | undefined => {
  const conditions: SQL[] = [];

  if (filter.search) {
    conditions.push(ilike(events.header, `%${filter.search}%`));
  }
  if (filter.tags?.length) {
    conditions.push(arrayOverlaps(events.tags, filter.tags));
  }
  if (filter.hcoeDomains?.length) {
    conditions.push(arrayOverlaps(events.hcoeDomains, filter.hcoeDomains));
  }
  if (filter.types?.length) {
    conditions.push(inArray(events.type, filter.types));
  }
  if (filter.reliabilities?.length) {
    conditions.push(inArray(events.admiraltyReliability, filter.reliabilities));
  }
  if (filter.credibilities?.length) {
    conditions.push(inArray(events.admiraltyAccuracy, filter.credibilities));
  }
  if (filter.createdBy) {
    conditions.push(eq(events.createdBy, filter.createdBy));
  }
  if (filter.eventTimeFrom) {
    conditions.push(gte(events.eventTime, filter.eventTimeFrom));
  }
  if (filter.eventTimeTo) {
    conditions.push(lte(events.eventTime, filter.eventTimeTo));
  }
  if (filter.createdAtFrom) {
    conditions.push(gte(events.createdAt, filter.createdAtFrom));
  }
  if (filter.createdAtTo) {
    conditions.push(lte(events.createdAt, filter.createdAtTo));
  }
  if (filter.location) {
    const { lng, lat, radiusMeters } = filter.location;
    conditions.push(
      sql`ST_DWithin(
        ${events.locationPoint}::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ${radiusMeters}
      )`,
    );
  }
  if (!filter.includeHistory) {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${events} child WHERE child.update_for = ${events.id})`,
    );
  }

  return conditions.length ? and(...conditions) : undefined;
};

const haversineMeters = (a: [number, number], b: [number, number]): number => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const f1 = toRad(lat1);
  const f2 = toRad(lat2);
  const aa = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(f1) * Math.cos(f2);
  return 2 * R * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
};

const overlaps = <T>(arr: T[] | null, want: T[]): boolean =>
  !!arr && want.some((w) => arr.includes(w));

export const matchesEventsFilter = (row: EventRow, filter: EventsFilter): boolean => {
  if (filter.search && !row.header.toLowerCase().includes(filter.search.toLowerCase())) {
    return false;
  }
  if (filter.tags?.length && !overlaps(row.tags, filter.tags)) return false;
  if (filter.hcoeDomains?.length && !overlaps(row.hcoeDomains, filter.hcoeDomains)) {
    return false;
  }
  if (filter.types?.length && (!row.type || !filter.types.includes(row.type))) {
    return false;
  }
  if (
    filter.reliabilities?.length &&
    (!row.admiraltyReliability || !filter.reliabilities.includes(row.admiraltyReliability))
  ) {
    return false;
  }
  if (
    filter.credibilities?.length &&
    (!row.admiraltyAccuracy || !filter.credibilities.includes(row.admiraltyAccuracy))
  ) {
    return false;
  }
  if (filter.createdBy && row.createdBy !== filter.createdBy) return false;
  if (filter.eventTimeFrom && (!row.eventTime || row.eventTime < filter.eventTimeFrom)) {
    return false;
  }
  if (filter.eventTimeTo && (!row.eventTime || row.eventTime > filter.eventTimeTo)) {
    return false;
  }
  if (filter.createdAtFrom && (!row.createdAt || row.createdAt < filter.createdAtFrom)) {
    return false;
  }
  if (filter.createdAtTo && (!row.createdAt || row.createdAt > filter.createdAtTo)) {
    return false;
  }
  if (filter.location) {
    if (!row.locationPoint) return false;
    const dist = haversineMeters(row.locationPoint, [filter.location.lng, filter.location.lat]);
    if (dist > filter.location.radiusMeters) return false;
  }
  return true;
};

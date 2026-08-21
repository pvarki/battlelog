import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "../../db/client.ts";
import type { EventInsert, EventRow } from "../../db/schema.ts";
import { events } from "../../db/schema.ts";
import { buildEventsWhere, type EventsFilter } from "./events.filter.ts";

export type CreateEventInput = Omit<EventInsert, "id" | "eventId" | "updateFor" | "createdAt">;

export type UpdateEventPatch = Partial<
  Omit<EventInsert, "id" | "eventId" | "updateFor" | "createdAt" | "createdBy">
>;

const isHead = sql`NOT EXISTS (
  SELECT 1 FROM ${events} child WHERE child.update_for = ${events.id}
)`;

/** Thrown when a concurrent update already superseded the head this update was based on. */
export class ConcurrentUpdateError extends Error {
  constructor(eventId: string) {
    super(`Event ${eventId} was updated concurrently`);
    this.name = "ConcurrentUpdateError";
  }
}

const isUpdateForConflict = (err: unknown): boolean => {
  // drizzle may throw the pg DatabaseError directly or wrapped as `cause`
  const e = err as { code?: unknown; constraint?: unknown; cause?: unknown } | null;
  const pg = (e?.code ? e : e?.cause) as { code?: unknown; constraint?: unknown } | undefined;
  return pg?.code === "23505" && pg?.constraint === "events_update_for_unique";
};

export const createEvent = async (input: CreateEventInput): Promise<EventRow> => {
  const id = uuidv7();
  const [row] = await db
    .insert(events)
    .values({ ...input, id, eventId: id, updateFor: null })
    .returning();
  if (!row) throw new Error("createEvent: insert returned no row");
  return row;
};

/**
 * Insert a new version row for the given logical event. Reads the current
 * head, applies `patch`, and inserts a new row with `updateFor = head.id`.
 * Linear-history is enforced at the DB by the unique constraint on
 * `update_for` — concurrent updates throw {@link ConcurrentUpdateError}.
 */
export const updateEvent = async (
  eventId: string,
  patch: UpdateEventPatch,
  updatedBy: string,
): Promise<EventRow | null> => {
  try {
    return await db.transaction(async (tx) => {
      const [head] = await tx
        .select()
        .from(events)
        .where(and(eq(events.eventId, eventId), isHead));
      if (!head) return null;

      const next: EventInsert = {
        ...head,
        ...patch,
        id: uuidv7(),
        eventId: head.eventId,
        updateFor: head.id,
        updatedBy,
        createdAt: new Date(),
      };
      const [row] = await tx.insert(events).values(next).returning();
      if (!row) throw new Error("updateEvent: insert returned no row");
      return row;
    });
  } catch (err) {
    if (isUpdateForConflict(err)) throw new ConcurrentUpdateError(eventId);
    throw err;
  }
};

/** Returns the current head row for the given logical eventId. */
export const getEvent = async (eventId: string): Promise<EventRow | null> => {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.eventId, eventId), isHead));
  return row ?? null;
};

/** Max rows per SSE replay; a full page makes the stream close so the client reconnects for the next page. */
export const REPLAY_LIMIT = 500;

/**
 * Rows inserted after `sinceId` that match `filter`, oldest first — used to
 * replay missed events on SSE reconnect (UUIDv7 ids are time-ordered). Ignores
 * head-only semantics: the live stream emits every insert, so replay does too.
 */
export const listEventsSince = async (
  sinceId: string,
  filter: EventsFilter,
): Promise<EventRow[]> => {
  const where = buildEventsWhere({ ...filter, includeHistory: true });
  return db
    .select()
    .from(events)
    .where(and(gt(events.id, sinceId), where))
    .orderBy(asc(events.id))
    .limit(REPLAY_LIMIT);
};

// Ordered by id, not createdAt: ids are UUIDv7 (same chronology), but unique —
// createdAt ties made offset page boundaries able to duplicate or skip rows.
export const listEvents = async (filter: EventsFilter): Promise<EventRow[]> => {
  const where = buildEventsWhere(filter);
  return db
    .select()
    .from(events)
    .where(filter.cursor ? and(lt(events.id, filter.cursor), where) : where)
    .orderBy(desc(events.id))
    .limit(filter.limit)
    .offset(filter.cursor ? 0 : filter.offset);
};

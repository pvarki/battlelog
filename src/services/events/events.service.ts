import { and, desc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "../../db/client.js";
import type { EventInsert, EventRow } from "../../db/schema.js";
import { events } from "../../db/schema.js";
import { eventsEmitter } from "./events.emitter.js";
import { buildEventsWhere, type EventsFilter } from "./events.filter.js";

export type CreateEventInput = Omit<EventInsert, "id" | "eventId" | "updateFor" | "createdAt">;

export type UpdateEventPatch = Partial<
  Omit<EventInsert, "id" | "eventId" | "updateFor" | "createdAt" | "createdBy">
>;

const isHead = sql`NOT EXISTS (
  SELECT 1 FROM ${events} child WHERE child.update_for = ${events.id}
)`;

export const createEvent = async (input: CreateEventInput): Promise<EventRow> => {
  const id = uuidv7();
  const [row] = await db
    .insert(events)
    .values({ ...input, id, eventId: id, updateFor: null })
    .returning();
  if (!row) throw new Error("createEvent: insert returned no row");
  eventsEmitter.emitNew(row);
  return row;
};

/**
 * Insert a new version row for the given logical event. Reads the current
 * head, applies `patch`, and inserts a new row with `updateFor = head.id`.
 * Linear-history is enforced at the DB by the unique constraint on
 * `update_for` — concurrent updates fail with a constraint violation.
 */
export const updateEvent = async (
  eventId: string,
  patch: UpdateEventPatch,
  updatedBy: string,
): Promise<EventRow | null> => {
  return db.transaction(async (tx) => {
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
    eventsEmitter.emitNew(row);
    return row;
  });
};

/** Returns the current head row for the given logical eventId. */
export const getEvent = async (eventId: string): Promise<EventRow | null> => {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.eventId, eventId), isHead));
  return row ?? null;
};

export const listEvents = async (filter: EventsFilter): Promise<EventRow[]> => {
  const where = buildEventsWhere(filter);
  return db
    .select()
    .from(events)
    .where(where)
    .orderBy(desc(events.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);
};

export { eventsEmitter };

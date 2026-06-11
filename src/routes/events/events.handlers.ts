import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../../lib/logger.ts";
import {
  type EventsFilter,
  eventsFilterSchema,
  matchesEventsFilter,
} from "../../services/events/events.filter.ts";
import {
  createEvent,
  eventsEmitter,
  getEvent,
  listEvents,
  updateEvent,
} from "../../services/events/events.service.ts";
import {
  createEventRequestSchema,
  toApiEvent,
  toCreateInput,
  toUpdatePatch,
  updateEventRequestSchema,
} from "./events.apiSchema.ts";

const readJson = async (c: Context) => {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
};

const parseJsonOrCsv = <T>(
  value: string | undefined,
  parser: (v: unknown) => T | undefined,
): T | undefined => {
  if (!value) return undefined;
  try {
    return parser(JSON.parse(value));
  } catch {
    return parser(value);
  }
};

const splitCsv = (v: unknown): string[] | undefined => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    const parts = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  }
  return undefined;
};

const parseFilterFromQuery = (c: Context): EventsFilter => {
  const q = c.req.query();
  const raw: Record<string, unknown> = {
    search: q.search,
    tags: parseJsonOrCsv(q.tags, splitCsv),
    hcoeDomains: parseJsonOrCsv(q.hcoeDomains, splitCsv),
    types: parseJsonOrCsv(q.types, splitCsv),
    reliabilities: parseJsonOrCsv(q.reliabilities, splitCsv),
    credibilities: parseJsonOrCsv(q.credibilities, splitCsv),
    createdBy: q.createdBy,
    eventTimeFrom: q.eventTimeFrom,
    eventTimeTo: q.eventTimeTo,
    createdAtFrom: q.createdAtFrom,
    createdAtTo: q.createdAtTo,
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
    includeHistory: q.includeHistory === "true",
  };
  if (q.lng && q.lat && q.radiusMeters) {
    raw.location = {
      lng: Number(q.lng),
      lat: Number(q.lat),
      radiusMeters: Number(q.radiusMeters),
    };
  }
  return eventsFilterSchema.parse(raw);
};

export const postEvent = async (c: Context) => {
  const json = await readJson(c);
  if (json === null) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = createEventRequestSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "Invalid input format" }, 400);
  }

  // TODO: replace 'anonymous' with the authenticated user once auth is wired back up.
  try {
    const row = await createEvent(toCreateInput(parsed.data, "anonymous"));
    return c.json(toApiEvent(row), 201);
  } catch (err) {
    logger.error({ err }, "postEvent failed");
    return c.json({ error: (err as Error).message }, 500);
  }
};

export const patchEvent = async (c: Context) => {
  const eventId = c.req.param("eventId");
  if (!eventId) return c.json({ error: "eventId is required" }, 400);

  const json = await readJson(c);
  if (json === null) return c.json({ error: "Invalid JSON body" }, 400);

  const parsed = updateEventRequestSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "Invalid input format" }, 400);
  }

  // TODO: replace 'anonymous' with the authenticated user once auth is wired back up.
  try {
    const row = await updateEvent(eventId, toUpdatePatch(parsed.data), "anonymous");
    if (!row) return c.json({ error: "Event not found" }, 404);
    return c.json(toApiEvent(row));
  } catch (err) {
    logger.error({ err }, "patchEvent failed");
    return c.json({ error: (err as Error).message }, 500);
  }
};

export const getEventHandler = async (c: Context) => {
  const eventId = c.req.param("eventId");
  if (!eventId) return c.json({ error: "eventId is required" }, 400);
  try {
    const row = await getEvent(eventId);
    if (!row) return c.json({ error: "Event not found" }, 404);
    return c.json(toApiEvent(row));
  } catch (err) {
    logger.error({ err }, "getEvent failed");
    return c.json({ error: (err as Error).message }, 500);
  }
};

export const listEventsHandler = async (c: Context) => {
  let filter: EventsFilter;
  try {
    filter = parseFilterFromQuery(c);
  } catch (err) {
    return c.json({ error: `Invalid filter: ${(err as Error).message}` }, 400);
  }
  try {
    const rows = await listEvents(filter);
    return c.json(rows.map(toApiEvent));
  } catch (err) {
    logger.error({ err }, "listEvents failed");
    return c.json({ error: (err as Error).message }, 500);
  }
};

export const streamNewEvents = (c: Context) => {
  let filter: EventsFilter;
  try {
    filter = parseFilterFromQuery(c);
  } catch (err) {
    return c.json({ error: `Invalid filter: ${(err as Error).message}` }, 400);
  }

  return streamSSE(c, async (stream) => {
    const unsubscribe = eventsEmitter.onNew((row) => {
      if (matchesEventsFilter(row, filter)) {
        stream
          .writeSSE({
            event: "event",
            data: JSON.stringify(toApiEvent(row)),
            id: row.id,
          })
          .catch((err) => logger.error({ err }, "SSE write failed"));
      }
    });

    stream.onAbort(() => unsubscribe());

    while (!stream.aborted) {
      await stream.sleep(15000);
      if (stream.aborted) break;
      await stream.writeSSE({ event: "ping", data: "" });
    }
  });
};

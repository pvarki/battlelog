import type { RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { validate as isUuid } from "uuid";
import type { EventRow } from "../../db/schema.ts";
import { logger } from "../../lib/logger.ts";
import { eventsEmitter } from "../../services/events/events.emitter.ts";
import { matchesEventsFilter } from "../../services/events/events.filter.ts";
import {
  ConcurrentUpdateError,
  createEvent,
  getEvent,
  listEvents,
  listEventsSince,
  REPLAY_LIMIT,
  updateEvent,
} from "../../services/events/events.service.ts";
import {
  eventsQuerySchema,
  queryToFilter,
  toApiEvent,
  toCreateInput,
  toUpdatePatch,
} from "./events.apiSchema.ts";
import type {
  getEventRoute,
  listEventsRoute,
  patchEventRoute,
  postEventRoute,
} from "./events.routes.ts";

export const postEvent: RouteHandler<typeof postEventRoute> = async (c) => {
  // "anonymous" only when RM_MTLS_USER_ENFORCE is off (local dev without the proxy)
  const user = c.get("userCn") ?? "anonymous";
  const row = await createEvent(toCreateInput(c.req.valid("json"), user));
  return c.json(toApiEvent(row), 201);
};

export const patchEvent: RouteHandler<typeof patchEventRoute> = async (c) => {
  const { eventId } = c.req.valid("param");
  const user = c.get("userCn") ?? "anonymous";
  try {
    const row = await updateEvent(eventId, toUpdatePatch(c.req.valid("json")), user);
    if (!row) return c.json({ error: "Event not found" }, 404);
    return c.json(toApiEvent(row), 200);
  } catch (err) {
    if (err instanceof ConcurrentUpdateError) {
      return c.json(
        { error: "Event was updated concurrently; fetch the latest version and retry" },
        409,
      );
    }
    throw err;
  }
};

export const getEventHandler: RouteHandler<typeof getEventRoute> = async (c) => {
  const { eventId } = c.req.valid("param");
  const row = await getEvent(eventId);
  if (!row) return c.json({ error: "Event not found" }, 404);
  return c.json(toApiEvent(row), 200);
};

export const listEventsHandler: RouteHandler<typeof listEventsRoute> = async (c) => {
  const filter = queryToFilter(c.req.valid("query"));
  const rows = await listEvents(filter);
  return c.json(rows.map(toApiEvent), 200);
};

export const streamNewEvents = (c: Context) => {
  const parsed = eventsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Invalid input format" }, 400);
  const filter = queryToFilter(parsed.data);

  // EventSource sends the last received SSE id on reconnect; replay what was
  // missed since then. A fresh page can't set that header, so its stored
  // cursor arrives as ?since= instead. Ignore anything that isn't a UUID.
  const header = c.req.header("last-event-id") ?? c.req.query("since");
  const lastEventId = header && isUuid(header) ? header : undefined;

  return streamSSE(
    c,
    async (stream) => {
      // UUIDv7 hex strings sort chronologically, so a string compare dedupes
      // replayed rows against live ones.
      let lastSentId = lastEventId ?? "";
      const sendRow = async (row: EventRow) => {
        if (row.id <= lastSentId) return;
        lastSentId = row.id;
        await stream.writeSSE({
          event: "event",
          data: JSON.stringify(toApiEvent(row)),
          id: row.id,
        });
      };

      // Buffer live rows until replay finishes so nothing is sent out of order.
      let replaying = lastEventId !== undefined;
      const buffer: EventRow[] = [];
      const unsubscribe = eventsEmitter.onNew((row) => {
        if (!matchesEventsFilter(row, filter)) return;
        if (replaying) {
          buffer.push(row);
          return;
        }
        sendRow(row).catch((err) => logger.error({ err }, "SSE write failed"));
      });

      stream.onAbort(() => unsubscribe());

      try {
        if (lastEventId) {
          let missed: EventRow[];
          try {
            missed = await listEventsSince(lastEventId, filter);
          } catch (err) {
            // Close instead of continuing live-only: new events would advance
            // the client's Last-Event-ID past the gap, making it unrecoverable.
            // EventSource auto-reconnects and retries the replay.
            logger.error({ err }, "SSE replay failed, closing stream");
            return;
          }
          for (const row of missed) await sendRow(row);
          if (missed.length === REPLAY_LIMIT) {
            // Gap larger than one replay page; close so the client reconnects
            // with the advanced Last-Event-ID and pages through the rest.
            return;
          }
          // length re-checked each iteration, so rows buffered mid-flush are included
          for (let i = 0; i < buffer.length; i++) {
            const row = buffer[i];
            if (row) await sendRow(row);
          }
          replaying = false;
        }

        while (!stream.aborted) {
          await stream.sleep(15000);
          if (stream.aborted) break;
          await stream.writeSSE({ event: "ping", data: "" });
        }
      } finally {
        // onAbort covers client disconnects; this covers early returns and
        // throws, where the stream closes without ever aborting.
        unsubscribe();
      }
    },
    // Without this, hono routes stream-callback errors to console.error,
    // outside pino and invisible to log shipping.
    async (err) => {
      logger.error({ err }, "SSE stream errored");
    },
  );
};

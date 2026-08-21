import { EventEmitter } from "node:events";
import type { EventRow } from "../../db/schema.ts";
import { logger } from "../../lib/logger.ts";

type EventsListener = (row: EventRow) => void;

class EventsEmitter extends EventEmitter {
  emitNew(row: EventRow): void {
    this.emit("new", row);
  }

  onNew(listener: EventsListener): () => void {
    // Isolate subscribers: EventEmitter runs them synchronously, so one throw
    // would starve every later subscriber of the row and propagate to the emitter.
    const safe: EventsListener = (row) => {
      try {
        listener(row);
      } catch (err) {
        logger.error({ err }, "events subscriber threw");
      }
    };
    this.on("new", safe);
    return () => {
      this.off("new", safe);
    };
  }
}

/**
 * Process-local broadcast of newly inserted event rows. Used by SSE handlers
 * to push matching events to subscribed clients.
 *
 * Fed by Postgres LISTEN/NOTIFY (see events.listener.ts + the events_notify
 * trigger), so every writer — this app, other instances, seed scripts, future
 * sinks — reaches subscribers, and only committed rows are ever emitted.
 */
export const eventsEmitter = new EventsEmitter();
eventsEmitter.setMaxListeners(0);

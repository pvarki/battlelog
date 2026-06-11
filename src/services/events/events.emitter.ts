import { EventEmitter } from "node:events";
import type { EventRow } from "../../db/schema.ts";

type EventsListener = (row: EventRow) => void;

class EventsEmitter extends EventEmitter {
  emitNew(row: EventRow): void {
    this.emit("new", row);
  }

  onNew(listener: EventsListener): () => void {
    this.on("new", listener);
    return () => {
      this.off("new", listener);
    };
  }
}

/**
 * Process-local broadcast of newly inserted event rows. Used by SSE handlers
 * to push matching events to subscribed clients.
 *
 * Limitation: in-memory only — does not survive horizontal scaling. For
 * multi-process delivery, swap for Postgres LISTEN/NOTIFY backed by an
 * AFTER INSERT trigger on the events table.
 */
export const eventsEmitter = new EventsEmitter();
eventsEmitter.setMaxListeners(0);

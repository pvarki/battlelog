import "varlock/auto-load";
import { asc, gt, inArray } from "drizzle-orm";
import pg from "pg";
import { ENV } from "varlock/env";
import { db } from "../../db/client.ts";
import type { EventRow } from "../../db/schema.ts";
import { events } from "../../db/schema.ts";
import { logger } from "../../lib/logger.ts";
import { eventsEmitter } from "./events.emitter.ts";

const RECONNECT_DELAY_MS = 3000;

/**
 * Feeds {@link eventsEmitter} from the Postgres `events_new` channel (see the
 * `events_notify` trigger). Runs on a dedicated connection — LISTEN is
 * per-session state, so it can't live on pooled connections. Reconnects with a
 * fixed delay and replays rows inserted while disconnected.
 */
export const startEventsListener = (): (() => Promise<void>) => {
  let stopped = false;
  let client: pg.Client | undefined;
  let lastSeenId: string | undefined;

  const emitRow = (row: EventRow) => {
    // UUIDv7 hex strings sort chronologically, so a string compare dedupes
    // catch-up overlap with live notifications.
    if (lastSeenId && row.id <= lastSeenId) return;
    lastSeenId = row.id;
    eventsEmitter.emitNew(row);
  };

  // ponytail: id > lastSeenId can miss a concurrent transaction that commits
  // late with an earlier uuid; track a commit-ordered cursor if that ever matters.
  const catchUp = async () => {
    if (!lastSeenId) return; // first connect: live-only, nothing to replay
    const missed = await db
      .select()
      .from(events)
      .where(gt(events.id, lastSeenId))
      .orderBy(asc(events.id));
    for (const row of missed) emitRow(row);
    if (missed.length) logger.info({ count: missed.length }, "events listener: replayed rows");
  };

  const run = async () => {
    while (!stopped) {
      const c = new pg.Client({ connectionString: ENV.DATABASE_URL });
      client = c;

      // Notifications are fetched and emitted strictly in arrival order by a
      // single drain loop — concurrent fetches can resolve out of order, and
      // the lastSeenId guard would then drop the earlier row for good. Fetches
      // are batched so a bulk insert (one NOTIFY per row) doesn't put the live
      // stream minutes behind at one round-trip per row. Draining is also held
      // back until catchUp() finishes, or a live row arriving mid-replay would
      // advance lastSeenId past every replayed row.
      const pending: string[] = [];
      let ready = false;
      let draining = false;
      const drain = async () => {
        if (draining) return;
        draining = true;
        try {
          while (pending.length) {
            const batch = pending.splice(0, 500);
            const rows = await db
              .select()
              .from(events)
              .where(inArray(events.id, batch))
              .orderBy(asc(events.id));
            for (const row of rows) emitRow(row);
          }
        } catch (err) {
          // Can't just log and move on: the next drain would advance lastSeenId
          // past the failed rows forever. Drop the connection instead, so the
          // reconnect's catchUp() replays them.
          logger.error({ err }, "events listener: failed to fetch notified rows, reconnecting");
          pending.length = 0;
          await c.end().catch(() => {});
        } finally {
          draining = false;
        }
        if (pending.length) void drain();
      };
      c.on("notification", (msg) => {
        if (!msg.payload) return;
        pending.push(msg.payload);
        if (ready) void drain();
      });

      const closed = new Promise<void>((resolve) => {
        c.on("error", (err) => {
          logger.error({ err }, "events listener: connection error");
          resolve();
        });
        c.on("end", () => resolve());
      });
      try {
        await c.connect();
        await c.query("LISTEN events_new");
        await catchUp();
        ready = true;
        void drain();
        logger.info("events listener connected");
        await closed;
      } catch (err) {
        logger.error({ err }, "events listener: connection failed");
      }
      await c.end().catch(() => {});
      if (!stopped) {
        logger.warn("events listener disconnected, reconnecting");
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
      }
    }
  };

  void run();

  return async () => {
    stopped = true;
    await client?.end().catch(() => {});
  };
};

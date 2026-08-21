import "varlock/auto-load";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { db, pool } from "../../db/client.ts";
import { events } from "../../db/schema.ts";
import { checkDbUp } from "../../db/test-helpers.ts";
import { eventsEmitter } from "./events.emitter.ts";
import { startEventsListener } from "./events.listener.ts";
import { createEvent } from "./events.service.ts";

// Integration test: requires the local compose DB (docker compose up -d db).
// Pins the whole realtime chain: events_notify trigger → events_new channel →
// listener → emitter. A migration renaming any of those breaks streaming
// silently everywhere else — this is the only test that would catch it.
const dbUp = await checkDbUp("events.listener test");

const runId = `listener-test-${Date.now()}`;

describe.runIf(dbUp)("events listener", () => {
  afterAll(async () => {
    await db.delete(events).where(eq(events.createdBy, runId));
    await pool.end();
  });

  test("delivers inserted rows to the emitter via NOTIFY", { timeout: 15_000 }, async () => {
    const stop = startEventsListener();
    const received = new Set<string>();
    const unsubscribe = eventsEmitter.onNew((row) => {
      if (row.createdBy === runId) received.add(row.id);
    });
    try {
      // The listener connects asynchronously with no ready signal; insert
      // until a notification gets through.
      for (let i = 0; i < 20 && received.size === 0; i++) {
        await createEvent({ createdBy: runId, updatedBy: null, header: `ping ${i}` });
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(received.size).toBeGreaterThan(0);
    } finally {
      unsubscribe();
      await stop();
    }
  });
});

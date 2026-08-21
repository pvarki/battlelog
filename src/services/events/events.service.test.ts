import "varlock/auto-load";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { db, pool } from "../../db/client.ts";
import { events } from "../../db/schema.ts";
import { checkDbUp } from "../../db/test-helpers.ts";
import { ConcurrentUpdateError, createEvent, updateEvent } from "./events.service.ts";

// Integration test: requires the local compose DB (docker compose up -d db).
const dbUp = await checkDbUp("events.service concurrency test");

const runId = `service-test-${Date.now()}`;

describe.runIf(dbUp)("updateEvent concurrency", () => {
  afterAll(async () => {
    await db.delete(events).where(eq(events.createdBy, runId));
    await pool.end();
  });

  test("concurrent updates: one wins, the loser gets ConcurrentUpdateError", async () => {
    // Both transactions read the same head before either commits, so exactly
    // one insert violates the update_for unique constraint. Retry a few rounds
    // in case the pool serializes them.
    for (let round = 0; round < 5; round++) {
      const ev = await createEvent({ createdBy: runId, updatedBy: null, header: "base" });
      const results = await Promise.allSettled([
        updateEvent(ev.eventId, { header: "a" }, "x"),
        updateEvent(ev.eventId, { header: "b" }, "y"),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      expect(ok.length).toBeGreaterThanOrEqual(1);
      for (const r of failed) {
        expect(r.reason).toBeInstanceOf(ConcurrentUpdateError);
      }
      if (failed.length === 1) return; // observed the conflict path — done
    }
    expect.fail("updates serialized in all 5 rounds; conflict path never exercised");
  });

  test("history stays linear after sequential updates", async () => {
    const ev = await createEvent({ createdBy: runId, updatedBy: null, header: "v1" });
    await updateEvent(ev.eventId, { header: "v2" }, "x");
    const v3 = await updateEvent(ev.eventId, { header: "v3" }, "x");
    expect(v3?.header).toBe("v3");

    const chain = await db.select().from(events).where(eq(events.eventId, ev.eventId));
    expect(chain).toHaveLength(3);
    expect(chain.filter((r) => r.updateFor === null)).toHaveLength(1);
  });
});

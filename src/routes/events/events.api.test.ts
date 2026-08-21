import "varlock/auto-load";
import { and, isNotNull, like } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { ENV } from "varlock/env";
import { afterAll, describe, expect, test } from "vitest";
import { createApp } from "../../app.ts";
import { db, pool } from "../../db/client.ts";
import { events } from "../../db/schema.ts";
import { checkDbUp } from "../../db/test-helpers.ts";

// Integration test: requires the local compose DB (docker compose up -d db).
// Full HTTP contract round-trip through the real app: validation shape,
// identity header → createdBy, lat/lng convention, versioning via PATCH.
const dbUp = await checkDbUp("events API round-trip test");

const app = createApp();
const runId = `api-test-${uuidv7()}`;
const dnHeader = { [ENV.RM_MTLS_HEADER]: `CN=${runId}` };
const json = { "content-type": "application/json", ...dnHeader };

describe.runIf(dbUp)("events HTTP contract", () => {
  afterAll(async () => {
    // Children before roots — the chain FK forbids deleting a still-referenced version.
    const mine = like(events.createdBy, `${runId}%`);
    await db.delete(events).where(and(mine, isNotNull(events.updateFor)));
    await db.delete(events).where(mine);
    await pool.end();
  });

  test("POST → GET → PATCH round-trip", async () => {
    const post = await app.request("/api/v1/events", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        header: "contact report",
        tags: ["alpha"],
        locationPoint: { lat: 60.17, lng: 24.94 },
      }),
    });
    expect(post.status).toBe(201);
    const created = await post.json();
    expect(created.createdBy).toBe(runId);
    expect(created.locationPoint).toEqual({ lat: 60.17, lng: 24.94 });

    const get = await app.request(`/api/v1/events/${created.eventId}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(created);

    const patch = await app.request(`/api/v1/events/${created.eventId}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ header: "updated report", tags: null }),
    });
    expect(patch.status).toBe(200);
    const updated = await patch.json();
    expect(updated.header).toBe("updated report");
    expect(updated.tags).toBeNull();
    expect(updated.locationPoint).toEqual({ lat: 60.17, lng: 24.94 }); // absent = keep
    expect(updated.updatedBy).toBe(runId);
    expect(updated.eventId).toBe(created.eventId);
    expect(updated.id).not.toBe(created.id);

    // GET now returns the new head
    const head = await app.request(`/api/v1/events/${created.eventId}`);
    expect((await head.json()).id).toBe(updated.id);
  });

  test("keyset pagination: cursor pages newest-first without overlap", async () => {
    const who = `${runId}-page`;
    const headers = { "content-type": "application/json", [ENV.RM_MTLS_HEADER]: `CN=${who}` };
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const res = await app.request("/api/v1/events", {
        method: "POST",
        headers,
        body: JSON.stringify({ header: `page ${n}` }),
      });
      ids.push((await res.json()).id);
    }

    const list = (qs: string) =>
      app.request(`/api/v1/events?createdBy=${who}&${qs}`).then((r) => r.json());

    const page1 = await list("limit=2");
    expect(page1.map((e: { id: string }) => e.id)).toEqual([ids[2], ids[1]]);

    const page2 = await list(`limit=2&cursor=${page1[1].id}`);
    expect(page2.map((e: { id: string }) => e.id)).toEqual([ids[0]]);
  });

  test("unknown eventId → 404", async () => {
    const res = await app.request(`/api/v1/events/${uuidv7()}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found" });
  });

  test("invalid body → 400 with the documented error shape", async () => {
    const res = await app.request("/api/v1/events", {
      method: "POST",
      headers: json,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input format" });
  });
});

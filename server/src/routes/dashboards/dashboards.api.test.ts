import "varlock/auto-load";
import { like } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { ENV } from "varlock/env";
import { afterAll, describe, expect, test } from "vitest";
import { createApp } from "../../app.ts";
import { db, pool } from "../../db/client.ts";
import { dashboards } from "../../db/schema.ts";
import { checkDbUp } from "../../db/test-helpers.ts";

// Integration test: requires the local compose DB (docker compose up -d db).
const dbUp = await checkDbUp("dashboards API round-trip test");

const app = createApp();
const runId = `dash-test-${uuidv7()}`;
const dnHeader = { [ENV.RM_MTLS_HEADER]: `CN=${runId}` };
const json = { "content-type": "application/json", ...dnHeader };

const clockWidget = { id: "w1", type: "clock", config: {}, layout: { x: 0, y: 0, w: 5, h: 4 } };

describe.runIf(dbUp)("dashboards HTTP contract", () => {
  afterAll(async () => {
    await db.delete(dashboards).where(like(dashboards.createdBy, `${runId}%`));
    await pool.end();
  });

  test("POST → GET → PATCH → DELETE round-trip with version handling", async () => {
    const post = await app.request("/api/v1/dashboards", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ name: "Ops overview", widgets: [clockWidget] }),
    });
    expect(post.status).toBe(201);
    const created = await post.json();
    expect(created.createdBy).toBe(runId);
    expect(created.widgets).toEqual([clockWidget]);
    expect(created.version).toBeTruthy();

    const list = await app.request("/api/v1/dashboards");
    expect(list.status).toBe(200);
    expect((await list.json()).some((d: { id: string }) => d.id === created.id)).toBe(true);

    const moved = { ...clockWidget, layout: { x: 4, y: 0, w: 6, h: 4 } };
    const patch = await app.request(`/api/v1/dashboards/${created.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ version: created.version, widgets: [moved] }),
    });
    expect(patch.status).toBe(200);
    const patched = await patch.json();
    expect(patched.widgets).toEqual([moved]);
    expect(patched.updatedBy).toBe(runId);
    expect(patched.version).not.toBe(created.version);

    // Stale version → 409, and the write must not apply.
    const stale = await app.request(`/api/v1/dashboards/${created.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ version: created.version, name: "clobbered" }),
    });
    expect(stale.status).toBe(409);
    const after = await app.request(`/api/v1/dashboards/${created.id}`);
    expect((await after.json()).name).toBe("Ops overview");

    const del = await app.request(`/api/v1/dashboards/${created.id}`, {
      method: "DELETE",
      headers: dnHeader,
    });
    expect(del.status).toBe(204);
    const gone = await app.request(`/api/v1/dashboards/${created.id}`);
    expect(gone.status).toBe(404);
  });

  test("templates carry the isTemplate flag; plain dashboards default off", async () => {
    const post = await app.request("/api/v1/dashboards", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ name: "Soldier template", isTemplate: true, widgets: [clockWidget] }),
    });
    expect(post.status).toBe(201);
    const created = await post.json();
    expect(created.isTemplate).toBe(true);

    const plain = await app.request("/api/v1/dashboards", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ name: "Plain", widgets: [] }),
    });
    expect((await plain.json()).isTemplate).toBe(false);
  });

  test("malformed widget structure is rejected", async () => {
    const res = await app.request("/api/v1/dashboards", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        name: "bad",
        widgets: [{ id: "w1", type: "clock", config: {}, layout: { x: 0, y: 0, w: 0, h: 2 } }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input format" });
  });
});

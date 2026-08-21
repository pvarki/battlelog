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

describe.runIf(dbUp)("dashboards HTTP contract", () => {
  afterAll(async () => {
    await db.delete(dashboards).where(like(dashboards.createdBy, `${runId}%`));
    await pool.end();
  });

  test("POST → GET → PATCH → DELETE round-trip", async () => {
    const post = await app.request("/api/v1/dashboards", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        name: "Ops overview",
        widgets: [{ id: "w1", type: "clock", x: 0, y: 0, w: 4, h: 3 }],
      }),
    });
    expect(post.status).toBe(201);
    const created = await post.json();
    expect(created.createdBy).toBe(runId);
    expect(created.widgets).toEqual([{ id: "w1", type: "clock", x: 0, y: 0, w: 4, h: 3 }]);

    const list = await app.request("/api/v1/dashboards");
    expect(list.status).toBe(200);
    expect((await list.json()).some((d: { id: string }) => d.id === created.id)).toBe(true);

    const patch = await app.request(`/api/v1/dashboards/${created.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({
        widgets: [{ id: "w1", type: "clock", x: 4, y: 0, w: 6, h: 4 }],
      }),
    });
    expect(patch.status).toBe(200);
    const patched = await patch.json();
    expect(patched.widgets[0]).toMatchObject({ x: 4, w: 6, h: 4 });
    expect(patched.updatedBy).toBe(runId);
    expect(patched.name).toBe("Ops overview");

    const del = await app.request(`/api/v1/dashboards/${created.id}`, {
      method: "DELETE",
      headers: dnHeader,
    });
    expect(del.status).toBe(204);
    const gone = await app.request(`/api/v1/dashboards/${created.id}`);
    expect(gone.status).toBe(404);
  });

  test("unknown widget type is rejected", async () => {
    const res = await app.request("/api/v1/dashboards", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        name: "bad",
        widgets: [{ id: "w1", type: "teleporter", x: 0, y: 0, w: 2, h: 2 }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input format" });
  });
});

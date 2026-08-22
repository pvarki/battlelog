import "varlock/auto-load";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, like } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, test } from "vitest";
import { db, pool } from "./client.ts";
import { dashboards } from "./schema.ts";
import { seedTemplates } from "./seed-templates.ts";
import { checkDbUp } from "./test-helpers.ts";

const dbUp = await checkDbUp("template seeding test");
const runName = `seed-test-${uuidv7()}`;

describe.runIf(dbUp)("seedTemplates", () => {
  afterAll(async () => {
    await db.delete(dashboards).where(like(dashboards.name, `${runName}%`));
    await pool.end();
  });

  test("upserts by name idempotently and skips invalid files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tmpl-"));
    const clock = { id: "c1", type: "clock", config: {}, layout: { x: 0, y: 0, w: 8, h: 6 } };
    await writeFile(path.join(dir, "a.json"), JSON.stringify({ name: runName, widgets: [clock] }));
    await writeFile(path.join(dir, "bad.json"), "{nope");
    expect(await seedTemplates(dir)).toBe(1);

    // Redeploy with changed widgets: updates the template in place.
    await writeFile(path.join(dir, "a.json"), JSON.stringify({ name: runName, widgets: [] }));
    expect(await seedTemplates(dir)).toBe(1);

    const rows = await db.select().from(dashboards).where(eq(dashboards.name, runName));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isTemplate).toBe(true);
    expect(rows[0]?.widgets).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  test("missing dir seeds nothing", async () => {
    expect(await seedTemplates("./no-such-templates-dir")).toBe(0);
  });
});

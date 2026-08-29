import "varlock/auto-load";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool } from "../../db/client.ts";
import { type EventRow, events } from "../../db/schema.ts";
import { checkDbUp } from "../../db/test-helpers.ts";
import {
  buildEventsWhere,
  type EventsFilter,
  eventsFilterSchema,
  matchesEventsFilter,
} from "./events.filter.ts";

// Integration test: requires the local compose DB (docker compose up -d db).
// Skips (with a warning) when Postgres is unreachable.
const dbUp = await checkDbUp("events.filter parity test");

const runId = `filter-parity-${uuidv7()}`;
const hour = 3600_000;
const t0 = new Date("2026-01-01T00:00:00Z");

const seedInputs = [
  {
    header: "Vihollinen havaittu ÄHTÄRISSÄ",
    tags: ["alpha"],
    hcoeDomains: ["cyber"],
    type: "contact",
    admiraltyReliability: "A",
    admiraltyAccuracy: "1",
    eventTime: t0,
    locationPoint: [24.94, 60.17],
  },
  {
    header: "quiet patrol",
    tags: ["alpha", "bravo"],
    hcoeDomains: ["military"],
    type: "patrol",
    admiraltyReliability: "B",
    admiraltyAccuracy: "2",
    eventTime: new Date(t0.getTime() + hour),
    locationPoint: [23.76, 61.5],
  },
  {
    header: "PATROL report",
    tags: ["bravo"],
    type: "patrol",
    admiraltyReliability: "F",
    admiraltyAccuracy: "6",
  },
  {
    header: "supply run",
    type: "logistics",
    eventTime: new Date(t0.getTime() + 3 * hour),
    locationPoint: [24.95, 60.18],
  },
] as const;

/** Stand-in ingest setup ids. No rows needed: events.ingest_source_id is not a FK. */
const SETUP_A = "01920000-0000-7000-8000-0000000000aa";
const SETUP_B = "01920000-0000-7000-8000-0000000000bb";

let seeded: EventRow[] = [];

const filter = (f: Record<string, unknown>): EventsFilter =>
  eventsFilterSchema.parse({ ...f, createdBy: runId, includeHistory: true });

const sqlIds = async (f: EventsFilter) => {
  const rows = await db.select().from(events).where(buildEventsWhere(f));
  return new Set(rows.map((r) => r.id));
};

const jsIds = (f: EventsFilter) =>
  new Set(seeded.filter((r) => matchesEventsFilter(r, f)).map((r) => r.id));

describe.runIf(dbUp)("buildEventsWhere / matchesEventsFilter parity", () => {
  beforeAll(async () => {
    seeded = await db
      .insert(events)
      .values(
        seedInputs.map((s, i) => {
          const id = uuidv7();
          // First row from setup A, second from setup B, the rest from none.
          const ingestSourceId = i === 0 ? SETUP_A : i === 1 ? SETUP_B : null;
          // Two shapes, as a real feed has: a form entry with a select field and
          // a boolean, and an ingested message.
          const data =
            i === 0
              ? { desk: "ARKI", journal: true, count: 2 }
              : i === 1
                ? { desk: "MATI", journal: true }
                : { body: "ingested" };
          return { ...s, id, eventId: id, updateFor: null, createdBy: runId, ingestSourceId, data };
        }),
      )
      .returning();
  });

  afterAll(async () => {
    await db.delete(events).where(eq(events.createdBy, runId));
    await pool.end();
  });

  test.each<[string, Record<string, unknown>]>([
    ["search, ascii case-insensitive", { search: "patrol" }],
    ["search, finnish case-insensitive", { search: "ähtärissä" }],
    ["tags overlap", { tags: ["alpha"] }],
    ["hcoe domains overlap", { hcoeDomains: ["cyber"] }],
    ["types", { types: ["patrol"] }],
    ["reliabilities", { reliabilities: ["A", "B"] }],
    ["credibilities", { credibilities: ["6"] }],
    [
      "eventTime window (null eventTime excluded)",
      { eventTimeFrom: t0.toISOString(), eventTimeTo: new Date(t0.getTime() + hour).toISOString() },
    ],
    ["createdAt in the future matches nothing", { createdAtFrom: "2100-01-01T00:00:00Z" }],
    ["geo radius 5km around Helsinki", { lat: 60.17, lng: 24.94, radiusMeters: 5000 }],
    ["combined tags + types", { tags: ["alpha"], types: ["patrol"] }],
    ["one ingest setup", { ingestSources: [SETUP_A] }],
    ["several ingest setups", { ingestSources: [SETUP_A, SETUP_B] }],
    ["an ingest setup nothing came from", { ingestSources: [uuidv7()] }],
    ["ingest setup + tags", { ingestSources: [SETUP_A, SETUP_B], tags: ["alpha"] }],
    ["a data field with a string value", { dataKey: "desk", dataValue: "ARKI" }],
    ["the other value of the same field", { dataKey: "desk", dataValue: "MATI" }],
    ["a data field holding true", { dataKey: "journal", dataValue: "true" }],
    ["a numeric data value", { dataKey: "count", dataValue: "2" }],
    ["a value nothing holds", { dataKey: "desk", dataValue: "NOPE" }],
    ["a field nothing has", { dataKey: "absent", dataValue: "x" }],
    ["data field + types", { dataKey: "desk", dataValue: "ARKI", types: ["contact"] }],
  ])("%s", async (_name, f) => {
    const parsed = filter(
      "lat" in f ? { ...f, location: { lat: f.lat, lng: f.lng, radiusMeters: f.radiusMeters } } : f,
    );
    expect(await sqlIds(parsed)).toEqual(jsIds(parsed));
  });

  test("eventId scopes to one logical event", async () => {
    const f = filter({ eventId: seeded[0]?.eventId });
    expect(await sqlIds(f)).toEqual(jsIds(f));
    expect((await sqlIds(f)).size).toBe(1);
  });

  test("sanity: seeded filters are not vacuously empty", async () => {
    expect((await sqlIds(filter({ tags: ["alpha"] }))).size).toBe(2);
    expect((await sqlIds(filter({ ingestSources: [SETUP_A] }))).size).toBe(1);
    expect((await sqlIds(filter({ ingestSources: [SETUP_A, SETUP_B] }))).size).toBe(2);
    expect((await sqlIds(filter({ dataKey: "desk", dataValue: "ARKI" }))).size).toBe(1);
    expect((await sqlIds(filter({ dataKey: "journal", dataValue: "true" }))).size).toBe(2);
    // The string "true" must not match the boolean true, or a view would show
    // rows it never asked for.
    expect((await sqlIds(filter({ dataKey: "journal", dataValue: "yes" }))).size).toBe(0);
  });
});

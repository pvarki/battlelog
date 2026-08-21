import { describe, expect, test } from "vitest";
import {
  eventsQuerySchema,
  PASSTHROUGH_NULLABLE,
  queryToFilter,
  toUpdatePatch,
  updateEventRequestSchema,
} from "./events.apiSchema.ts";

describe("toUpdatePatch", () => {
  test("absent = keep (key omitted), null = clear", () => {
    expect(toUpdatePatch({ header: "x", tags: null })).toEqual({ header: "x", tags: null });
    expect(toUpdatePatch({})).toEqual({});
  });

  test("transforms eventTime and locationPoint", () => {
    expect(
      toUpdatePatch({
        eventTime: "2026-01-01T00:00:00.000Z",
        locationPoint: { lat: 60.17, lng: 24.94 },
      }),
    ).toEqual({ eventTime: new Date("2026-01-01T00:00:00Z"), locationPoint: [24.94, 60.17] });
    expect(toUpdatePatch({ eventTime: null, locationPoint: null })).toEqual({
      eventTime: null,
      locationPoint: null,
    });
  });

  test("handles every request field — a new schema field must be wired up here", () => {
    const handled = new Set<string>([
      "header",
      "eventTime",
      "locationPoint",
      ...PASSTHROUGH_NULLABLE,
    ]);
    for (const key of Object.keys(updateEventRequestSchema.shape)) {
      expect(handled.has(key), `toUpdatePatch silently ignores '${key}'`).toBe(true);
    }
  });
});

describe("queryToFilter geo params", () => {
  const base = eventsQuerySchema.parse({});

  test("all of lng/lat/radiusMeters → location filter", () => {
    expect(queryToFilter({ ...base, lng: 24.94, lat: 60.17, radiusMeters: 1000 }).location).toEqual(
      { lng: 24.94, lat: 60.17, radiusMeters: 1000 },
    );
  });

  test("partial geo params are ignored", () => {
    expect(queryToFilter({ ...base, lng: 24.94, lat: 60.17 }).location).toBeUndefined();
    expect(queryToFilter({ ...base, radiusMeters: 1000 }).location).toBeUndefined();
  });
});

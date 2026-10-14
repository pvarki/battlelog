import { describe, expect, test } from "vitest";
import type { EventResponse } from "../../api.ts";
import { dataRows } from "./EventDetails.tsx";
import {
  colorHex,
  type EventLayer,
  inWindow,
  LAYER_EVENT_TYPE,
  layerFeatures,
  layerFetch,
  layersOf,
  newLayer,
} from "./layers.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-14T12:30:00Z");

const event = (patch: Partial<EventResponse>): EventResponse => ({
  id: "row-1",
  eventId: "ev-1",
  createdBy: "alpha",
  updatedBy: null,
  createdAt: new Date(NOW - HOUR).toISOString(),
  header: "Drone seen",
  eventTime: null,
  tags: null,
  hcoeDomains: null,
  admiraltyReliability: null,
  admiraltyAccuracy: null,
  location: null,
  locationPoint: { lat: 60.2, lng: 24.9 },
  inputSource: null,
  sourceUri: null,
  type: "sighting",
  data: { status: "confirmed", drone: { kind: "FPV" } },
  ...patch,
});

const layer = (patch: Partial<EventLayer["definition"]> = {}): EventLayer => ({
  eventId: "layer-1",
  rowId: "layer-row-1",
  definition: {
    ...newLayer(),
    name: "Sightings",
    query: { types: "sighting", tags: "", dataFilters: [] },
    ...patch,
  },
});

describe("layersOf", () => {
  test("keeps valid, undeleted layer events, sorted by name", () => {
    const rows = [
      event({ eventId: "b", type: LAYER_EVENT_TYPE, data: { ...newLayer(), name: "Bravo" } }),
      event({ eventId: "a", type: LAYER_EVENT_TYPE, data: { ...newLayer(), name: "Alpha" } }),
      event({ eventId: "d", type: LAYER_EVENT_TYPE, data: { name: "Gone", deleted: true } }),
      event({ eventId: "x", type: "sighting" }),
      event({ eventId: "bad", type: LAYER_EVENT_TYPE, data: { color: "plaid" } }),
    ];
    expect(layersOf(rows).map((l) => l.definition.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("layerFetch", () => {
  test("asks for located events logged since the hour the window opened", () => {
    const fetch = layerFetch(layer().definition.query, 24, NOW);
    expect(fetch?.query).toMatchObject({
      types: "sighting",
      located: "true",
      occurredFrom: "2026-10-13T12:00:00.000Z",
    });
  });

  test("replay reaches back as far as the replay does", () => {
    const fetch = layerFetch(layer().definition.query, 1, NOW, 6 * HOUR);
    expect(fetch?.query).toMatchObject({ occurredFrom: "2026-10-14T05:00:00.000Z" });
  });

  test("no window, no time limit; no type, no fetch", () => {
    expect(layerFetch(layer().definition.query, undefined, NOW)?.query).not.toHaveProperty(
      "occurredFrom",
    );
    expect(layerFetch({ types: "", tags: "", dataFilters: [] }, 24, NOW)).toBeUndefined();
  });

  test("live rows must have a position and match the query", () => {
    const match = layerFetch(layer().definition.query, 24, NOW)?.match;
    expect(match?.(event({}))).toBe(true);
    expect(match?.(event({ locationPoint: null }))).toBe(false);
    expect(match?.(event({ type: "patrol" }))).toBe(false);
  });
});

describe("inWindow", () => {
  test("uses the event's own time, else when it was logged", () => {
    const old = event({ eventTime: new Date(NOW - 30 * HOUR).toISOString() });
    expect(inWindow(old, 24, NOW)).toBe(false);
    expect(inWindow(old, undefined, NOW)).toBe(true);
    expect(inWindow(event({}), 24, NOW)).toBe(true);
  });

  test("an event after the replay moment isn't there yet", () => {
    expect(inWindow(event({}), 24, NOW - 2 * HOUR)).toBe(false);
  });
});

describe("layerFeatures", () => {
  test("labels by data path and colours by value, falling back to the layer's", () => {
    const definition = {
      labelPath: "drone.kind",
      colorBy: { path: "status", options: [{ value: "confirmed", color: "red" as const }] },
    };
    const [confirmed] = layerFeatures(layer(definition), [event({})], NOW);
    expect(confirmed?.properties).toMatchObject({
      eventId: "ev-1",
      label: "FPV · confirmed",
      color: colorHex("red"),
    });
    const [other] = layerFeatures(layer(definition), [event({ data: { status: "?" } })], NOW);
    expect(other?.properties).toMatchObject({ label: "Drone seen · ?", color: colorHex("blue") });
  });
});

test("dataRows flattens scalars to dot paths and skips empties", () => {
  expect(dataRows({ a: 1, b: { c: "x", d: "" }, e: null })).toEqual([
    ["a", "1"],
    ["b.c", "x"],
  ]);
});

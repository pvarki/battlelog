import { expect, test } from "vitest";
import type { TakItem } from "../cot.ts";
import {
  activeFilters,
  affiliationOf,
  type FilterContext,
  feedSource,
  filterSources,
  kindOf,
  matchesFilters,
  NO_FILTERS,
  PLAN_SOURCE,
  sortFlat,
} from "./item-filters.ts";

const NOW = 1_000_000;

const item = (uid: string, type: string, extra: Partial<TakItem> = {}): TakItem => ({
  uid,
  type,
  time: NOW - 60_000,
  stale: NOW + 60_000,
  geometry: { type: "Point", coordinates: [25, 60] },
  event: {} as TakItem["event"],
  ...extra,
});

const ctx: FilterContext = {
  now: NOW,
  view: { west: 24, south: 59, east: 26, north: 61 },
  feeds: new Map([["RECON", new Set(["fed"])]]),
};

test.each([
  ["a-f-G-U-C", { team: "Cyan" }, "friendly", "people"],
  ["a-h-G", {}, "hostile", "markers"],
  ["a-n-G", {}, "neutral", "markers"],
  ["a-u-G", {}, "unknown", "markers"],
  ["b-m-p-s-m", {}, undefined, "markers"],
  ["u-d-f", {}, undefined, "shapes"],
  ["b-m-r", {}, undefined, "routes"],
] as const)("%s is %s, a %s", (type, extra, affiliation, kind) => {
  expect(affiliationOf(item("x", type, extra))).toBe(affiliation);
  expect(kindOf(item("x", type, extra))).toBe(kind);
});

test("each filter narrows on its own", () => {
  const near = item("near", "a-h-G");
  const far = item("far", "a-h-G", { geometry: { type: "Point", coordinates: [30, 65] } });
  const stale = item("stale", "a-u-G", { stale: NOW - 1 });
  const old = item("old", "a-u-G", { time: NOW - 2 * 3_600_000 });
  const fed = item("fed", "a-f-G");
  const draft = item("draft", "a-f-G", { draft: true });
  const all = [near, far, stale, old, fed, draft];
  const pass = (f: Partial<typeof NO_FILTERS>) =>
    all.filter((i) => matchesFilters(i, { ...NO_FILTERS, ...f }, ctx)).map((i) => i.uid);

  expect(pass({})).toEqual(all.map((i) => i.uid));
  expect(pass({ inView: true })).not.toContain("far");
  expect(pass({ statuses: ["stale"] })).toEqual(["stale"]);
  expect(pass({ affiliations: ["hostile"] })).toEqual(["near", "far"]);
  expect(pass({ updatedWithin: 60 })).not.toContain("old");
  expect(pass({ sources: [feedSource("RECON")] })).toEqual(["fed"]);
  expect(pass({ sources: [PLAN_SOURCE] })).toEqual(["draft"]);
});

test("a shape counts as in view when any of it is", () => {
  const route = item("route", "b-m-r", {
    geometry: {
      type: "LineString",
      coordinates: [
        [20, 60],
        [30, 60],
      ],
    },
  });
  expect(matchesFilters(route, { ...NO_FILTERS, inView: true }, ctx)).toBe(true);
});

test("an item without a fix is never in view", () => {
  const unplaced = item("unplaced", "a-f-G", { geometry: { type: "Point", coordinates: [0, 0] } });
  expect(matchesFilters(unplaced, { ...NO_FILTERS, inView: true }, ctx)).toBe(false);
});

test("nearest first puts unplaced items last; newest first by time", () => {
  const a = item("a", "a-u-G", { geometry: { type: "Point", coordinates: [25.5, 60] } });
  const b = item("b", "a-u-G", { geometry: { type: "Point", coordinates: [25.1, 60] } });
  const c = item("c", "a-u-G", { geometry: { type: "Point", coordinates: [0, 0] }, time: NOW });
  expect(sortFlat([c, a, b], "distance", [25, 60]).map((i) => i.uid)).toEqual(["b", "a", "c"]);
  expect(sortFlat([a, b, c], "newest").map((i) => i.uid)[0]).toBe("c");
});

test("counts the filters in use", () => {
  expect(activeFilters(NO_FILTERS)).toBe(0);
  expect(activeFilters({ ...NO_FILTERS, inView: true, kinds: ["shapes"] })).toBe(2);
});

test("a feed named like the plan source is still a feed", () => {
  const feeds = new Map([["plan", new Set(["fed"])]]);
  const fed = item("fed", "a-f-G");
  const draft = item("draft", "a-f-G", { draft: true });
  const only = (source: string) =>
    [fed, draft]
      .filter((i) => matchesFilters(i, { ...NO_FILTERS, sources: [source] }, { ...ctx, feeds }))
      .map((i) => i.uid);
  expect(only(feedSource("plan"))).toEqual(["fed"]);
  expect(only(PLAN_SOURCE)).toEqual(["draft"]);
});

test("in view across the antimeridian", () => {
  const east = item("east", "a-u-G", { geometry: { type: "Point", coordinates: [-175, 60] } });
  const view = { west: 170, south: 50, east: 190, north: 70 };
  expect(matchesFilters(east, { ...NO_FILTERS, inView: true }, { ...ctx, view })).toBe(true);
});

test("sources offer plan drafts only when there are some, then feeds by name", () => {
  const feeds = new Map([
    ["RECON", new Set<string>()],
    ["ALPHA", new Set<string>()],
  ]);
  expect(filterSources([item("a", "a-f-G")], feeds).map((s) => s.label)).toEqual([
    "ALPHA",
    "RECON",
  ]);
  expect(filterSources([item("d", "a-f-G", { draft: true })], new Map())).toEqual([
    { value: PLAN_SOURCE, label: "Plan drafts" },
  ]);
});

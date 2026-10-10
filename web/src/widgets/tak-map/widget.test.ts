import { describe, expect, test } from "vitest";
import type { TakFeature } from "../../api.ts";
import {
  contactsOf,
  formatMgrs,
  hasPosition,
  isFaded,
  layerOf,
  liveItems,
  missionItems,
  sidcFor,
  statusOf,
  teamColor,
} from "./symbols.ts";
import descriptor, { type TakMapConfig } from "./widget.ts";

const feature = (cotType: string, extra: Partial<TakFeature["properties"]> = {}): TakFeature => ({
  type: "Feature",
  id: cotType,
  geometry: { type: "Point", coordinates: [24.9, 60.2] },
  properties: { cotType, time: "2026-10-10T12:00:00Z", stale: "2026-10-10T12:05:00Z", ...extra },
});

test("defaultConfig validates; empty config gets defaults", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
  expect(descriptor.configSchema.parse({})).toMatchObject({
    basemap: "osm",
    missionFilter: "except",
    showLive: true,
    view: "fit-once",
  });
});

const config = (patch: Partial<TakMapConfig> = {}) => ({
  ...descriptor.configSchema.parse({}),
  ...patch,
});

describe("layerOf", () => {
  test("splits users, units, markers and drawings", () => {
    expect(layerOf(feature("a-f-G-U-C", { team: "Cyan" }))).toBe("contacts");
    expect(layerOf(feature("a-f-A-M-H-Q"))).toBe("units");
    expect(layerOf(feature("a-h-G"))).toBe("units");
    expect(layerOf(feature("b-m-p-s-m"))).toBe("markers");
    expect(layerOf(feature("u-d-c-c"))).toBe("drawings");
    expect(layerOf(feature("b-m-r"))).toBe("drawings");
  });
});

describe("sidcFor", () => {
  test("maps CoT atoms to 15-char 2525B codes", () => {
    expect(sidcFor("a-f-G-U-C-I")).toBe("SFGPUCI--------");
    expect(sidcFor("a-h-G")).toBe("SHGP-----------");
    expect(sidcFor("a-f-A-M-H-Q")).toBe("SFAPMHQ--------");
    expect(sidcFor("a-u-G")).toHaveLength(15);
  });
});

test("hasPosition rejects ATAK's 0,0 no-GPS placeholder", () => {
  expect(hasPosition(feature("a-f-G"))).toBe(true);
  expect(
    hasPosition({ ...feature("a-f-G"), geometry: { type: "Point", coordinates: [0, 0] } }),
  ).toBe(false);
});

test("teamColor falls back to cyan", () => {
  expect(teamColor("Red")).toBe("#ff0000");
  expect(teamColor(undefined)).toBe("#00ffff");
});

test("isFaded for stale or offline items", () => {
  const now = Date.parse("2026-10-10T12:01:00Z");
  expect(isFaded(feature("a-f-G"), now)).toBe(false);
  expect(isFaded(feature("a-f-G"), Date.parse("2026-10-10T12:06:00Z"))).toBe(true);
  expect(isFaded(feature("a-f-G", { offline: true }), now)).toBe(true);
});

test("formatMgrs groups zone, square, easting, northing", () => {
  expect(formatMgrs([24.9384, 60.1699])).toMatch(/^35V L\w \d{5} \d{5}$/);
  expect(formatMgrs([-74.0445, 40.6892])).toMatch(/^18T \w\w \d{5} \d{5}$/);
  expect(formatMgrs([0, 85])).toBeUndefined();
});

test("contactsOf lists online users first, then stale, then offline", () => {
  const now = Date.parse("2026-10-10T12:01:00Z");
  const c = (id: string, extra: Partial<TakFeature["properties"]>) => ({
    ...feature("a-f-G-U-C", { team: "Cyan", callsign: id, ...extra }),
    id,
  });
  const list = contactsOf(
    [
      c("Zed", {}),
      c("Off", { offline: true }),
      c("Old", { stale: "2026-10-10T12:00:30Z" }),
      c("Abe", {}),
      feature("a-h-G"),
    ],
    now,
  );
  expect(list.map((f) => f.id)).toEqual(["Abe", "Zed", "Old", "Off"]);
  expect(statusOf(list[2] as TakFeature, now)).toBe("stale");
});

test("missionItems shows visible missions once, without items already live", () => {
  const a = { ...feature("a-u-G"), id: "a" };
  const b = { ...feature("u-d-c-c"), id: "b" };
  const c = { ...feature("b-m-r"), id: "c" };
  const missions = [
    { name: "RECON", keywords: [], items: [a, b] },
    { name: "OTHER", keywords: [], items: [b, c] },
    { name: "HIDDEN", keywords: [], items: [{ ...feature("a-h-G"), id: "h" }] },
  ];
  const hidden = config({ missionNames: ["HIDDEN"] });
  expect(missionItems(missions, hidden, [a]).map((f) => f.id)).toEqual(["b", "c"]);
  const only = config({ missionFilter: "only", missionNames: ["HIDDEN"] });
  expect(missionItems(missions, only, []).map((f) => f.id)).toEqual(["h"]);
});

test("liveItems applies the live, team, age and stale filters", () => {
  const now = Date.parse("2026-10-10T12:01:00Z");
  const cyan = { ...feature("a-f-G-U-C", { team: "Cyan" }), id: "cyan" };
  const red = { ...feature("a-f-G-U-C", { team: "Red" }), id: "red" };
  const old = { ...feature("a-h-G", { time: "2026-10-10T10:00:00Z" }), id: "old" };
  const stale = { ...feature("a-h-G", { stale: "2026-10-10T12:00:30Z" }), id: "stale" };
  const all = [cyan, red, old, stale];
  const ids = (patch: Partial<TakMapConfig>) => liveItems(all, config(patch), now).map((f) => f.id);
  expect(ids({})).toEqual(["cyan", "red", "old", "stale"]);
  expect(ids({ showLive: false })).toEqual([]);
  expect(ids({ teams: ["Red"] })).toEqual(["red", "old", "stale"]);
  expect(ids({ maxAgeMinutes: 30 })).toEqual(["cyan", "red", "stale"]);
  expect(ids({ showStale: false })).toEqual(["cyan", "red", "old"]);
});

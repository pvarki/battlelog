import { describe, expect, test } from "vitest";
import type { TakFeature } from "../../api.ts";
import { hasPosition, isFaded, layerOf, sidcFor, teamColor } from "./symbols.ts";
import descriptor from "./widget.ts";

const feature = (cotType: string, extra: Partial<TakFeature["properties"]> = {}): TakFeature => ({
  type: "Feature",
  id: cotType,
  geometry: { type: "Point", coordinates: [24.9, 60.2] },
  properties: { cotType, time: "2026-10-10T12:00:00Z", stale: "2026-10-10T12:05:00Z", ...extra },
});

test("defaultConfig validates; empty config gets defaults", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
  expect(descriptor.configSchema.parse({})).toEqual({ basemap: "osm", hiddenLayers: [] });
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

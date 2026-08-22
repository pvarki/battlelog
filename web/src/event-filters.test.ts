import { describe, expect, it } from "vitest";
import { type Applied, activeChips, compact, EMPTY } from "./event-filters.ts";

const labels = (a: Applied) => activeChips(a).map((c) => c.label);

describe("compact", () => {
  it("drops empty fields so shared URLs stay short", () => {
    expect(compact(EMPTY)).toEqual({});
    expect(
      compact({ ...EMPTY, search: "bridge", types: ["report"], includeHistory: false }),
    ).toEqual({ search: "bridge", types: ["report"] });
  });
});

describe("activeChips", () => {
  it("has nothing to show when nothing is applied", () => {
    expect(activeChips({})).toEqual([]);
  });

  it("gives list filters one chip per value", () => {
    expect(labels({ tags: ["bar", "baz"] })).toEqual(["Tag: bar", "Tag: baz"]);
  });

  it("removing one list value keeps the others", () => {
    const bar = activeChips({ tags: ["bar", "baz"], search: "x" }).find((c) => c.id === "tags:bar");
    expect(bar?.without).toEqual({ tags: ["baz"], search: "x" });
  });

  it("removing the last list value drops the key entirely", () => {
    const only = activeChips({ tags: ["bar"], search: "x" }).find((c) => c.id === "tags:bar");
    expect(only?.without).toEqual({ search: "x" });
  });

  it("puts the header search chip first, since the header owns that field", () => {
    expect(activeChips({ tags: ["bar"], search: "x" })[0]?.id).toBe("search");
  });

  it("treats lat/lng/radius as one chip, since they only filter together", () => {
    const applied: Applied = { lat: 60.17, lng: 24.94, radiusMeters: 500, search: "x" };
    const geo = activeChips(applied).find((c) => c.id === "geo");
    expect(geo?.label).toBe("Within 500 m of 60.17, 24.94");
    expect(geo?.without).toEqual({ search: "x" });
  });

  it("ignores an incomplete geo triple, matching what the server actually filters on", () => {
    expect(activeChips({ lat: 60.17, lng: 24.94 })).toEqual([]);
  });

  it("never mutates the applied object it was given", () => {
    const applied: Applied = { tags: ["bar", "baz"], includeHistory: true };
    const snapshot = structuredClone(applied);
    activeChips(applied);
    expect(applied).toEqual(snapshot);
  });
});

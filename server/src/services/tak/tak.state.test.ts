import { describe, expect, test } from "vitest";
import type { CotChange, TakFeature } from "./cot.ts";
import { createTakState, parseMissionList, type TakStateChange } from "./tak.state.ts";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 10, 12, minute)).toISOString();

const item = (id: string, minute: number, staleMinute = minute + 5): CotChange => ({
  kind: "upsert",
  feature: {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [24.9, 60.2] },
    properties: { cotType: "a-f-G-U-C", time: at(minute), stale: at(staleMinute) },
  } satisfies TakFeature,
});

const del = (uid: string, minute: number): CotChange => ({ kind: "delete", uid, time: at(minute) });

const record = () => {
  const state = createTakState({ maxItems: 3, staleGraceMs: 60_000, markRetentionMs: 600_000 });
  const changes: TakStateChange[] = [];
  state.onChange((c) => changes.push(c));
  const ids = () => state.snapshot().map((f) => f.id);
  return { state, changes, ids };
};

describe("tak state", () => {
  test("newest version wins regardless of arrival order", () => {
    const { state } = record();
    state.apply(item("a", 10));
    state.apply(item("a", 5));
    expect(state.snapshot()[0]?.properties.time).toBe(at(10));
  });

  test("delete removes the item and blocks an older replayed copy", () => {
    const { state, changes, ids } = record();
    state.apply(item("a", 1));
    state.apply(del("a", 2));
    state.apply(item("a", 1));
    expect(ids()).toEqual([]);
    expect(changes.map((c) => c.kind)).toEqual(["upsert", "delete"]);
  });

  test("an update newer than the delete brings the item back", () => {
    const { state, ids } = record();
    state.apply(del("a", 2));
    state.apply(item("a", 3));
    expect(ids()).toEqual(["a"]);
  });

  test("offline marks the contact until a newer report, regardless of arrival order", () => {
    const { state } = record();
    const off: CotChange = { kind: "offline", uid: "a", time: at(3) };
    state.apply(off);
    state.apply(item("a", 2));
    expect(state.snapshot()[0]?.properties.offline).toBe(true);
    state.apply(item("a", 4));
    expect(state.snapshot()[0]?.properties.offline).toBeUndefined();
    state.apply({ ...off, time: at(5) });
    expect(state.snapshot()[0]?.properties.offline).toBe(true);
  });

  test("sweep keeps stale items through the grace period, then drops them", () => {
    const { state, ids } = record();
    state.apply(item("a", 0, 5));
    state.sweep(Date.parse(at(5)) + 30_000);
    expect(ids()).toEqual(["a"]);
    state.sweep(Date.parse(at(5)) + 61_000);
    expect(ids()).toEqual([]);
  });

  test("delete marks outlive the stale grace, so a replayed older copy stays deleted", () => {
    const { state, ids } = record();
    state.apply(del("a", 2));
    state.sweep(Date.parse(at(2)) + 120_000);
    state.apply(item("a", 1, 60));
    expect(ids()).toEqual([]);
  });

  test("cap evicts the oldest item", () => {
    const { state, ids } = record();
    for (const [id, m] of [
      ["b", 2],
      ["a", 1],
      ["c", 3],
      ["d", 4],
    ] as const)
      state.apply(item(id, m));
    expect(ids().sort()).toEqual(["b", "c", "d"]);
  });
});

describe("missions", () => {
  test("setMissions emits only when the list actually changes", () => {
    const { state, changes } = record();
    const recon = { name: "RECON", keywords: ["#RECON"], items: [] };
    state.setMissions([recon]);
    state.setMissions([{ ...recon }]);
    expect(changes.filter((c) => c.kind === "missions")).toHaveLength(1);
    expect(state.missions()).toEqual([recon]);
  });

  test("parseMissionList keeps named missions and their metadata", () => {
    const json = JSON.stringify({
      version: "3",
      type: "Mission",
      data: [
        {
          name: "RECON",
          description: "Recon feed",
          creatorUid: "",
          createTime: "2026-09-16T15:45:33.021Z",
          keywords: ["#RECON"],
          uids: [],
        },
        { description: "nameless" },
      ],
    });
    expect(parseMissionList(json)).toEqual([
      {
        name: "RECON",
        description: "Recon feed",
        creatorUid: undefined,
        createTime: "2026-09-16T15:45:33.021Z",
        keywords: ["#RECON"],
      },
    ]);
    expect(parseMissionList("")).toEqual([]);
  });
});

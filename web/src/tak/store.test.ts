import { expect, test } from "vitest";
import type { TakItem } from "./cot.ts";
import { createTakStore } from "./store.ts";

const item = (uid: string, time: number, stale = time + 1000): TakItem => ({
  uid,
  type: "a-f-G",
  time,
  stale,
  geometry: { type: "Point", coordinates: [25, 60] },
  event: {} as TakItem["event"],
});

const snapshot = (store: ReturnType<typeof createTakStore>) => {
  store.flush();
  return store.getSnapshot();
};

test("the newest version wins, whatever the arrival order", () => {
  const store = createTakStore();
  store.apply({ kind: "upsert", item: item("a", 200) });
  store.apply({ kind: "upsert", item: item("a", 100) });
  expect(snapshot(store).map((i) => i.time)).toEqual([200]);
});

test("a delete stops an older replayed copy coming back", () => {
  const store = createTakStore();
  store.apply({ kind: "upsert", item: item("a", 100) });
  store.apply({ kind: "delete", uid: "a", time: 150 });
  store.apply({ kind: "upsert", item: item("a", 120) });
  expect(snapshot(store)).toEqual([]);
  store.apply({ kind: "upsert", item: item("a", 200) });
  expect(snapshot(store)).toHaveLength(1);
});

test("a disconnect marks the user offline until they report again", () => {
  const store = createTakStore();
  store.apply({ kind: "upsert", item: item("a", 100) });
  store.apply({ kind: "offline", uid: "a", time: 150 });
  expect(snapshot(store)[0]?.offline).toBe(true);
  store.apply({ kind: "upsert", item: item("a", 200) });
  expect(snapshot(store)[0]?.offline).toBeUndefined();
});

test("stale items go after the grace period", () => {
  const store = createTakStore({ staleGraceMs: 1000 });
  store.apply({ kind: "upsert", item: item("a", 100, 500) });
  store.sweep(1400);
  expect(snapshot(store)).toHaveLength(1);
  store.sweep(1600);
  expect(snapshot(store)).toEqual([]);
});

test("over the cap, the oldest item goes", () => {
  const store = createTakStore({ maxItems: 2 });
  for (const [uid, time] of [
    ["a", 100],
    ["b", 300],
    ["c", 200],
  ] as const) {
    store.apply({ kind: "upsert", item: item(uid, time) });
  }
  expect(
    snapshot(store)
      .map((i) => i.uid)
      .sort(),
  ).toEqual(["b", "c"]);
});

test("listeners hear one notification per batch, not per change", () => {
  const store = createTakStore();
  let calls = 0;
  store.subscribe(() => calls++);
  store.apply({ kind: "upsert", item: item("a", 100) });
  store.apply({ kind: "upsert", item: item("b", 100) });
  store.flush();
  expect(calls).toBe(1);
  expect(store.getSnapshot()).toBe(store.getSnapshot());
});

test("an item that moves leaves a track, which goes with the item", () => {
  const store = createTakStore();
  const moved = (time: number, lon: number): TakItem => ({
    ...item("a", time),
    geometry: { type: "Point", coordinates: [lon, 60] },
  });
  store.apply({ kind: "upsert", item: item("b", 100) });
  store.apply({ kind: "upsert", item: item("b", 200) });
  store.apply({ kind: "upsert", item: moved(100, 25) });
  store.apply({ kind: "upsert", item: moved(200, 25.01) });
  store.flush();
  expect(
    store
      .getTracks()
      .get("a")
      ?.map((p) => p.position[0]),
  ).toEqual([25, 25.01]);
  expect(store.getTracks().has("b")).toBe(false);
  store.apply({ kind: "delete", uid: "a", time: 300 });
  store.flush();
  expect(store.getTracks().has("a")).toBe(false);
});

test("the last track ageing out clears it from the snapshot", () => {
  const store = createTakStore();
  const at = (time: number, lon: number): TakItem => ({
    ...item("a", time, time + 365 * 86_400_000),
    geometry: { type: "Point", coordinates: [lon, 60] },
  });
  store.apply({ kind: "upsert", item: at(1_000, 25) });
  store.apply({ kind: "upsert", item: at(2_000, 25.01) });
  store.flush();
  expect(store.getTracks().has("a")).toBe(true);
  store.sweep(2_000 + 3 * 3_600_000);
  store.flush();
  expect(store.getTracks().has("a")).toBe(false);
});

test("a delete for an item never seen is still saved, so the archive can't bring it back", () => {
  const store = createTakStore();
  store.apply({ kind: "delete", uid: "gone", time: 150 });
  expect(store.takeDirty()).toEqual(["gone"]);
  expect(store.recordOf("gone")).toEqual({ uid: "gone", tombstone: 150 });
  expect(store.takeDirty()).toEqual([]);
});

test("a restored picture keeps its deletes and counts as already saved", () => {
  const saved = createTakStore();
  saved.apply({ kind: "upsert", item: item("a", 100) });
  saved.apply({ kind: "delete", uid: "b", time: 150 });
  const records = saved.takeDirty().flatMap((uid) => saved.recordOf(uid) ?? []);

  const store = createTakStore();
  store.restore(records, 200);
  expect(store.takeDirty()).toEqual([]);
  expect(snapshot(store).map((i) => i.uid)).toEqual(["a"]);
  store.apply({ kind: "upsert", item: item("b", 120) });
  expect(snapshot(store).map((i) => i.uid)).toEqual(["a"]);
});

test("removing an expired item marks it for deletion from the saved picture", () => {
  const store = createTakStore({ staleGraceMs: 0 });
  store.apply({ kind: "upsert", item: item("a", 100, 200) });
  store.takeDirty();
  store.sweep(300);
  expect(store.takeDirty()).toEqual(["a"]);
  expect(store.recordOf("a")).toBeUndefined();
});

test("over the mark cap, the oldest deletes and disconnects go, and that is saved", () => {
  const store = createTakStore({ maxMarks: 10 });
  for (let time = 1; time <= 11; time++) {
    store.apply({ kind: "delete", uid: `gone${time}`, time });
    store.apply({ kind: "offline", uid: `left${time}`, time });
  }
  const kept = (prefix: string) =>
    Array.from({ length: 11 }, (_, i) => `${prefix}${i + 1}`).filter((uid) => store.recordOf(uid));
  expect(kept("gone")).not.toContain("gone1");
  expect(kept("gone")).toContain("gone11");
  expect(kept("gone").length).toBeLessThanOrEqual(10);
  expect(kept("left")).not.toContain("left1");
  expect(kept("left").length).toBeLessThanOrEqual(10);
  expect(store.takeDirty()).toContain("gone1");
});

test("a restored picture over the mark cap drops its oldest marks", () => {
  const store = createTakStore({ maxMarks: 1 });
  store.restore(
    [
      { uid: "old", tombstone: 100 },
      { uid: "new", tombstone: 200 },
    ],
    300,
  );
  expect(store.deletedAt("old")).toBeUndefined();
  expect(store.deletedAt("new")).toBe(200);
});

test("a restored picture over the item cap drops its oldest items, and saves that", () => {
  const store = createTakStore({ maxItems: 1 });
  store.restore(
    [
      { uid: "old", item: item("old", 100) },
      { uid: "new", item: item("new", 200) },
    ],
    300,
  );
  expect(snapshot(store).map((i) => i.uid)).toEqual(["new"]);
  expect(store.takeDirty()).toEqual(["old"]);
});

test("a sweep that expires nothing keeps each trail's array, so the map needn't redraw it", () => {
  const store = createTakStore();
  const now = Date.now();
  const at = (time: number, lon: number): TakItem => ({
    ...item("a", time, now + 60_000),
    geometry: { type: "Point", coordinates: [lon, 60] },
  });
  store.apply({ kind: "upsert", item: at(now - 2000, 25) });
  store.apply({ kind: "upsert", item: at(now - 1000, 25.01) });
  store.flush();
  const before = store.getTracks().get("a");
  store.sweep(now);
  store.flush();
  expect(store.getTracks().get("a")).toBe(before);
});

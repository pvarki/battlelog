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

import { expect, test } from "vitest";
import { oldestUnused, remember, touch } from "./lru.ts";

test("over the cap, the least recently used entries go first", () => {
  const cache = new Map<string, number>();
  remember(cache, "a", 1, 2);
  remember(cache, "b", 2, 2);
  expect(touch(cache, "a")).toBe(1);
  expect(remember(cache, "c", 3, 2)).toEqual([2]);
  expect([...cache.keys()]).toEqual(["a", "c"]);
  expect(touch(cache, "b")).toBeUndefined();
});

test("storing a key again replaces it without evicting", () => {
  const cache = new Map([["a", 1]]);
  expect(remember(cache, "a", 2, 1)).toEqual([]);
  expect(cache.get("a")).toBe(2);
});

test("images still in use are never picked for eviction", () => {
  expect(oldestUnused(["a", "b", "c", "d"], 2, new Set(["a", "c"]))).toEqual(["b", "d"]);
  expect(oldestUnused(["a", "b"], 2, new Set(["a", "b"]))).toEqual([]);
});

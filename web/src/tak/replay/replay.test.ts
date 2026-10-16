import { expect, test } from "vitest";
import type { TakChange, TakItem } from "../cot.ts";
import { DAY_MS } from "../store.ts";
import { spansToFetch } from "./archive.ts";
import { archiveChunks, createReplay, mergeChanges } from "./replay.ts";

const HOUR = 60 * 60 * 1000;

const item = (uid: string, time: number, lon = 25): TakItem => ({
  uid,
  type: "a-f-G",
  time,
  stale: time + HOUR,
  geometry: { type: "Point", coordinates: [lon, 60] },
  event: {} as TakItem["event"],
});

const upsert = (uid: string, time: number, lon?: number): TakChange => ({
  kind: "upsert",
  item: item(uid, time, lon),
});

test("archive windows are at most a day, newest first, and cover the whole range", () => {
  expect(archiveChunks(0, 2.5 * DAY_MS)).toEqual([
    [1.5 * DAY_MS, 2.5 * DAY_MS],
    [0.5 * DAY_MS, 1.5 * DAY_MS],
    [0, 0.5 * DAY_MS],
  ]);
  expect(archiveChunks(5, 5)).toEqual([]);
});

test("only what the session hasn't fetched is fetched again", () => {
  const have = { from: 10 * HOUR, to: 12 * HOUR };
  expect(spansToFetch(undefined, 0, HOUR)).toEqual([{ from: 0, to: HOUR }]);
  expect(spansToFetch(have, 11 * HOUR, 12 * HOUR)).toEqual([]);
  const later = spansToFetch(have, 8 * HOUR, 13 * HOUR);
  expect(later[0]?.from).toBeLessThan(12 * HOUR);
  expect(later).toEqual([later[0], { from: 8 * HOUR, to: 10 * HOUR }]);
  expect(spansToFetch(have, 14 * HOUR, 15 * HOUR)).toEqual([{ from: 14 * HOUR, to: 15 * HOUR }]);
});

test("merged changes are in time order without repeats, the newest kept", () => {
  const merged = mergeChanges(
    [upsert("a", 3), upsert("a", 1)],
    [upsert("a", 3), upsert("b", 2)],
    2,
  );
  expect(merged.map((c) => (c.kind === "upsert" ? c.item.time : 0))).toEqual([2, 3]);
});

test("the picture at a moment holds what was there then, by the live store's rules", () => {
  const replay = createReplay(
    [
      upsert("a", 10, 25),
      upsert("b", 20),
      upsert("a", 30, 25.1),
      { kind: "delete", uid: "b", time: 40 },
      upsert("b", 35),
    ],
    [item("static", 0)],
  );
  const uids = (at: number) =>
    replay
      .at(at)
      .items.map((i) => i.uid)
      .sort();
  expect(uids(5)).toEqual(["static"]);
  expect(uids(25)).toEqual(["a", "b", "static"]);
  expect(uids(45)).toEqual(["a", "static"]);
  expect(uids(15)).toEqual(["a", "static"]);
  expect(replay.at(30).items.find((i) => i.uid === "a")?.geometry.coordinates).toEqual([25.1, 60]);
});

test("trails reach only up to the moment shown", () => {
  const replay = createReplay(
    [upsert("a", 10, 25), upsert("a", 20, 25.1), upsert("a", 30, 25.2)],
    [],
  );
  const trailTimes = (at: number) =>
    replay
      .at(at)
      .tracks.get("a")
      ?.map((p) => p.time);
  expect(trailTimes(20)).toEqual([10, 20]);
  expect(trailTimes(30)).toEqual([10, 20, 30]);
  expect(trailTimes(20)).toEqual([10, 20]);
});

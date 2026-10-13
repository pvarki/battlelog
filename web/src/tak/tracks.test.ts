import { expect, test } from "vitest";
import type { Position, TakItem } from "./cot.ts";
import {
  mergeTrack,
  TRACK_MAX_AGE_MS,
  TRACK_MAX_POINTS,
  type TrackPoint,
  trackColor,
  trackFeatures,
} from "./tracks.ts";

const at = (time: number, lon = 25 + time / 1000): TrackPoint => ({ position: [lon, 60], time });

const item = (uid: string, type: string, position: Position, team?: string): TakItem => ({
  uid,
  type,
  time: 0,
  stale: 0,
  team,
  geometry: { type: "Point", coordinates: position },
  event: {} as TakItem["event"],
});

test("points from the live stream and history merge in time order", () => {
  const track = mergeTrack([at(3000)], [at(1000), at(2000)], 3000);
  expect(track.map((p) => p.time)).toEqual([1000, 2000, 3000]);
});

test("GPS jitter and no-fix positions are not movement", () => {
  const jitter: TrackPoint = { position: [25.00001, 60], time: 2 };
  const noFix: TrackPoint = { position: [0, 0], time: 3 };
  expect(mergeTrack([], [at(1, 25), jitter, noFix], 3)).toEqual([at(1, 25)]);
});

test("tracks keep the last two hours and at most the point cap", () => {
  const now = TRACK_MAX_AGE_MS + 5000;
  expect(mergeTrack([at(4000), at(6000)], [], now).map((p) => p.time)).toEqual([6000]);
  const many = Array.from({ length: TRACK_MAX_POINTS + 10 }, (_, i) => at(i * 1000));
  const capped = mergeTrack([], many, many.length * 1000);
  expect(capped).toHaveLength(TRACK_MAX_POINTS);
  expect(capped.at(-1)?.time).toBe((many.length - 1) * 1000);
});

test("users are in their team colour, units in ATAK's affiliation colour", () => {
  expect(trackColor(item("u", "a-f-G-U-C", [25, 60], "Cyan"))).toBe("#00ffff");
  expect(trackColor(item("d", "a-f-A-M-F-Q", [25, 60]))).toBe("#80e0ff");
  expect(trackColor(item("h", "a-h-G", [25, 60]))).toBe("#ff8080");
});

test("a track runs to the item's current position, unless its group is hidden", () => {
  const drone = item("d", "a-f-A", [25.003, 60]);
  const tracks = new Map([["d", [at(1000), at(2000)]]]);
  const [line, crumbs] = trackFeatures([drone], tracks, new Set()).features;
  expect(line?.geometry).toEqual({
    type: "LineString",
    coordinates: [
      [26, 60],
      [27, 60],
      [25.003, 60],
    ],
  });
  expect(crumbs?.geometry.type).toBe("MultiPoint");
  expect(trackFeatures([drone], tracks, new Set(["markers/friendly"])).features).toEqual([]);
});

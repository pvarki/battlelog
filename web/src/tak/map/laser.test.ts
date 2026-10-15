import { expect, test } from "vitest";
import { STROKE_FADE_MS, STROKE_HOLD_MS, strokeAlpha, TRAIL_MS, trailAlpha } from "./laser.ts";

test("the trail fades out over its life", () => {
  const point = { lngLat: [25, 60] as [number, number], t: 1000 };
  expect(trailAlpha(point, 1000)).toBe(1);
  expect(trailAlpha(point, 1000 + TRAIL_MS / 2)).toBeCloseTo(0.5);
  expect(trailAlpha(point, 1000 + TRAIL_MS * 2)).toBe(0);
});

test("a stroke stays while drawn, holds after release, then fades", () => {
  expect(strokeAlpha(undefined, 99_999)).toBe(1);
  expect(strokeAlpha(1000, 1000 + STROKE_HOLD_MS)).toBe(1);
  expect(strokeAlpha(1000, 1000 + STROKE_HOLD_MS + STROKE_FADE_MS / 2)).toBeCloseTo(0.5);
  expect(strokeAlpha(1000, 1000 + STROKE_HOLD_MS + STROKE_FADE_MS)).toBe(0);
});

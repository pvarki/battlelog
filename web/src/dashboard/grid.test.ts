import { expect, test } from "vitest";
import type { Widget } from "../api.ts";
import { layoutBlocks } from "./grid.ts";

const widget = (layout: Widget["layout"]): Widget => ({
  id: "w1",
  type: "clock",
  config: {},
  layout,
});

test("slots become percentages of the canvas", () => {
  expect(layoutBlocks([widget({ x: 0, y: 0, w: 24, h: 12 })], 48, 24)).toEqual([
    { id: "w1", left: 0, top: 0, width: 50, height: 50 },
  ]);
  expect(layoutBlocks([widget({ x: 24, y: 12, w: 24, h: 12 })], 48, 24)).toEqual([
    { id: "w1", left: 50, top: 50, width: 50, height: 50 },
  ]);
});

test("a slot wider or taller than the canvas is clamped, never painted outside", () => {
  const [block] = layoutBlocks([widget({ x: 40, y: 20, w: 40, h: 40 })], 48, 24);
  expect(block).toEqual({
    id: "w1",
    left: (40 / 48) * 100,
    top: (20 / 24) * 100,
    width: (8 / 48) * 100,
    height: (4 / 24) * 100,
  });
  // Right and bottom edges land exactly on the frame.
  expect((block?.left ?? 0) + (block?.width ?? 0)).toBeCloseTo(100);
  expect((block?.top ?? 0) + (block?.height ?? 0)).toBeCloseTo(100);
});

test("negative coordinates from a hand-edited import are pulled back inside", () => {
  expect(layoutBlocks([widget({ x: -5, y: -5, w: 4, h: 4 })], 48, 24)).toEqual([
    { id: "w1", left: 0, top: 0, width: (4 / 48) * 100, height: (4 / 24) * 100 },
  ]);
});

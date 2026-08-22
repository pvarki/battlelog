import { describe, expect, it } from "vitest";
import { firstFreeSlot } from "./placement.ts";

const COLS = 48;
const ROWS = 24;
const slot = (taken: { x: number; y: number; w: number; h: number }[], w: number, h: number) =>
  firstFreeSlot(taken, { w, h }, COLS, ROWS);

describe("firstFreeSlot", () => {
  it("puts the first widget top-left", () => {
    expect(slot([], 8, 6)).toEqual({ x: 0, y: 0 });
  });

  it("tiles rightwards along a row instead of stacking at x=0", () => {
    expect(slot([{ x: 0, y: 0, w: 8, h: 6 }], 8, 6)).toEqual({ x: 8, y: 0 });
  });

  it("drops to the next row when the row cannot fit the widget", () => {
    // 44 of 48 columns used, so a 8-wide widget cannot follow on row 0.
    expect(slot([{ x: 0, y: 0, w: 44, h: 6 }], 8, 6)).toEqual({ x: 0, y: 6 });
  });

  it("finds a gap between two widgets", () => {
    const taken = [
      { x: 0, y: 0, w: 10, h: 4 },
      { x: 18, y: 0, w: 10, h: 4 },
    ];
    expect(slot(taken, 8, 4)).toEqual({ x: 10, y: 0 });
  });

  it("skips a gap that is too narrow", () => {
    const taken = [
      { x: 0, y: 0, w: 10, h: 4 },
      { x: 14, y: 0, w: 34, h: 4 },
    ];
    // The 4-wide gap at x=10 cannot hold a 8-wide widget: next row instead.
    expect(slot(taken, 8, 4)).toEqual({ x: 0, y: 4 });
  });

  it("returns null when the canvas is full — the caller must refuse, not stack", () => {
    const full = [{ x: 0, y: 0, w: COLS, h: ROWS }];
    expect(slot(full, 4, 3)).toBeNull();
  });

  it("returns null rather than clamping a widget larger than the canvas", () => {
    expect(slot([], COLS + 1, 2)).toBeNull();
    expect(slot([], 2, ROWS + 1)).toBeNull();
  });

  it("uses the last free row when everything above is occupied", () => {
    const taken = [{ x: 0, y: 0, w: COLS, h: ROWS - 3 }];
    expect(slot(taken, 8, 3)).toEqual({ x: 0, y: ROWS - 3 });
  });

  it("never overlaps anything it was told about", () => {
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < 20; i++) {
      const found = firstFreeSlot(taken, { w: 9, h: 5 }, COLS, ROWS);
      if (!found) break;
      const placed = { ...found, w: 9, h: 5 };
      for (const t of taken) {
        const overlaps =
          placed.x < t.x + t.w &&
          placed.x + placed.w > t.x &&
          placed.y < t.y + t.h &&
          placed.y + placed.h > t.y;
        expect(overlaps).toBe(false);
      }
      taken.push(placed);
    }
    // 5 across x 4 down fit in 48x24 at 9x5.
    expect(taken).toHaveLength(20);
  });
});

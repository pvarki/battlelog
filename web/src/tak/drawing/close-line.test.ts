import { expect, test } from "vitest";
import type { Position } from "../cot.ts";
import { closedAtStart } from "./useDrawing.ts";

// One degree is one pixel, so pixel tolerances read directly.
const pixels = ([x1, y1]: Position, [x2, y2]: Position) => Math.hypot(x2 - x1, y2 - y1);
const square: Position[] = [
  [0, 0],
  [100, 0],
  [100, 100],
];

test("a click on the start point closes the line, dropping terra-draw's copies of the click", () => {
  const click: Position = [3, 2];
  expect(closedAtStart([...square, click, click], click, pixels)).toEqual([...square, [0, 0]]);
});

test("a click away from the start point, or on a line too short to close, leaves it open", () => {
  expect(closedAtStart([...square, [60, 60]], [60, 60], pixels)).toBeUndefined();
  expect(
    closedAtStart(
      [
        [0, 0],
        [100, 0],
        [1, 1],
      ],
      [1, 1],
      pixels,
    ),
  ).toBeUndefined();
});

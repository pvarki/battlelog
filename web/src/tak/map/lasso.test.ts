import { expect, test } from "vitest";
import { insideOutline, type ScreenPoint } from "./lasso.ts";

// An L-shaped outline: the notch at the top right is outside.
const L: ScreenPoint[] = [
  [0, 0],
  [10, 0],
  [10, 20],
  [30, 20],
  [30, 30],
  [0, 30],
];

test("a point is inside the outline only where the outline encloses it", () => {
  expect(insideOutline([5, 5], L)).toBe(true);
  expect(insideOutline([25, 25], L)).toBe(true);
  expect(insideOutline([25, 5], L)).toBe(false);
  expect(insideOutline([40, 25], L)).toBe(false);
});

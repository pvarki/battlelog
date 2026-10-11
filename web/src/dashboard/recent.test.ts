import { expect, test } from "vitest";
import { withOpened } from "./recent.ts";

test("reopening moves a view to the front without duplicating it, capped at six", () => {
  expect(withOpened(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  expect(withOpened(["1", "2", "3", "4", "5", "6"], "7")).toEqual(["7", "1", "2", "3", "4", "5"]);
});

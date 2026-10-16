import { expect, test } from "vitest";
import { parseViewParam, viewParam } from "./tools.ts";

test("a view survives the trip through a URL", () => {
  const view = { center: [24.94123, 60.17055] as [number, number], zoom: 13.5, bearing: 30 };
  expect(parseViewParam(viewParam(view))).toEqual(view);
  expect(viewParam({ ...view, bearing: 0 })).toBe("24.94123,60.17055,13.5");
});

test("malformed or out-of-range views are ignored", () => {
  for (const bad of [undefined, "", "1,2", "a,b,c", "200,60,10", "24,95,10", "24,60,30"])
    expect(parseViewParam(bad)).toBeUndefined();
});

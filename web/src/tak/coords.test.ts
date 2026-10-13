import { expect, test } from "vitest";
import { formatCoord, parseCoord } from "./coords.ts";
import type { Position } from "./cot.ts";

const helsinki: Position = [24.9384, 60.1699];

const near = (a: Position | undefined, b: Position, tolerance = 1e-4) => {
  expect(a).toBeDefined();
  expect(Math.abs((a as Position)[0] - b[0])).toBeLessThan(tolerance);
  expect(Math.abs((a as Position)[1] - b[1])).toBeLessThan(tolerance);
};

test("formats one position in every format", () => {
  expect(formatCoord(helsinki, "mgrs")).toMatch(/^35V LG \d{5} \d{5}$/);
  expect(formatCoord(helsinki, "dd")).toBe("60.16990°N 24.93840°E");
  expect(formatCoord(helsinki, "ddm")).toBe("60°10.194'N 024°56.304'E");
  expect(formatCoord(helsinki, "dms")).toBe(`60°10'11.6"N 024°56'18.2"E`);
  expect(formatCoord(helsinki, "tm35fin")).toMatch(/^N 667\d{4} E 385\d{3}$/);
});

test("southern and western hemispheres", () => {
  expect(formatCoord([-70.5, -33.25], "dd")).toBe("33.25000°S 70.50000°W");
});

test("minutes never round up to 60", () => {
  expect(formatCoord([24.99999999, 60.99999999], "ddm")).toBe("61°00.000'N 025°00.000'E");
});

test("every format parses back to the same place", () => {
  for (const format of ["mgrs", "dd", "ddm", "dms", "tm35fin"] as const) {
    near(parseCoord(formatCoord(helsinki, format)), helsinki, 2e-5);
  }
});

test("parses common hand-typed forms", () => {
  near(parseCoord("60.1699, 24.9384"), helsinki);
  near(parseCoord("60,1699 24,9384"), helsinki);
  near(parseCoord("35VLG8576672067"), parseCoord("35V LG 85766 72067") as Position);
  near(parseCoord("P 6672500 I 385700"), parseCoord("N 6672500 E 385700") as Position);
});

test("rejects text that isn't a coordinate", () => {
  expect(parseCoord("KETTU23a")).toBeUndefined();
  expect(parseCoord("")).toBeUndefined();
  expect(parseCoord("95, 24")).toBeUndefined();
});

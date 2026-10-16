import { expect, test } from "vitest";
import { readLike } from "./stored-setting.ts";

test("a stored value of the wrong kind reads as the default", () => {
  expect(readLike("{}", [])).toEqual([]);
  expect(readLike('[{"id":"a"}]', [])).toEqual([{ id: "a" }]);
  expect(readLike('"x"', 0.6)).toBe(0.6);
  expect(readLike("0.3", 0.6)).toBe(0.3);
  expect(readLike("{broken", false)).toBe(false);
  expect(readLike(undefined, "mgrs")).toBe("mgrs");
  expect(readLike('"osm"', null)).toBe("osm");
});

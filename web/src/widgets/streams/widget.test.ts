import { expect, test } from "vitest";
import descriptor, { resolveType } from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("a full streams config validates; bad sourceType is rejected", () => {
  expect(
    descriptor.configSchema.safeParse({
      title: "Cam 1",
      url: "http://mtx:8889/cam1/whep",
      sourceType: "whep",
    }).success,
  ).toBe(true);
  expect(descriptor.configSchema.safeParse({ url: "x", sourceType: "rtsp" }).success).toBe(false);
});

test("resolveType honours an explicit override", () => {
  expect(resolveType({ url: "http://x/feed", sourceType: "auto" })).toBe("video");
  expect(resolveType({ url: "http://x/feed", sourceType: "hls" })).toBe("hls");
});

import { expect, test } from "vitest";
import descriptor, { detectSourceType, resolveType } from "./widget.ts";

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

test("detectSourceType resolves player from the URL shape", () => {
  expect(detectSourceType("http://mtx:8889/cam1/whep")).toBe("whep");
  expect(detectSourceType("http://mtx:8888/cam1/index.m3u8")).toBe("hls");
  expect(detectSourceType("https://cdn.example.com/live.m3u8?token=abc")).toBe("hls");
  expect(detectSourceType("http://cam/snapshot.mjpg")).toBe("mjpeg");
  expect(detectSourceType("http://cam/axis-cgi/mjpeg/video.cgi")).toBe("mjpeg");
  expect(detectSourceType("https://example.com/clip.mp4")).toBe("video");
});

test("resolveType honours an explicit override", () => {
  expect(resolveType({ url: "http://x/feed", sourceType: "auto" })).toBe("video");
  expect(resolveType({ url: "http://x/feed", sourceType: "hls" })).toBe("hls");
});

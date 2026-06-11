import { expect, test } from "vitest";
import { extractClientIp } from "./client-ip.ts";

test("extractClientIp returns socket IP when no XFF and hops=0", () => {
  expect(extractClientIp({ xff: undefined, remoteAddr: "10.0.0.1", hops: 0 })).toBe("10.0.0.1");
});

test("extractClientIp peels 1 hop from XFF", () => {
  expect(extractClientIp({ xff: "203.0.113.1, 10.0.0.5", remoteAddr: "10.0.0.5", hops: 1 })).toBe(
    "203.0.113.1",
  );
});

test("extractClientIp peels 2 hops from XFF", () => {
  expect(
    extractClientIp({ xff: "1.1.1.1, 2.2.2.2, 3.3.3.3", remoteAddr: "3.3.3.3", hops: 2 }),
  ).toBe("1.1.1.1");
});

test("extractClientIp falls back to remoteAddr when hops exceed XFF", () => {
  expect(extractClientIp({ xff: "1.1.1.1", remoteAddr: "3.3.3.3", hops: 5 })).toBe("3.3.3.3");
});

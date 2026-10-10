import { describe, expect, it } from "vitest";
import { shouldNotify } from "./notify.ts";

const me = { userId: "@me:x", name: "Me" };
const now = 1_000_000_000;
const msg = (body: string, extra: object = {}) => ({
  sender: "@bob:x",
  ts: now,
  content: { body, ...extra },
});

describe("shouldNotify", () => {
  it("follows the level", () => {
    expect(shouldNotify("off", msg("hi Me"), me, now)).toBe(false);
    expect(shouldNotify("all", msg("hello"), me, now)).toBe(true);
    expect(shouldNotify("mentions", msg("hello"), me, now)).toBe(false);
    expect(shouldNotify("mentions", msg("hi Me"), me, now)).toBe(true);
    expect(
      shouldNotify("mentions", msg("hey", { "m.mentions": { user_ids: ["@me:x"] } }), me, now),
    ).toBe(true);
  });

  it("skips own and stale messages", () => {
    expect(shouldNotify("all", { ...msg("x"), sender: "@me:x" }, me, now)).toBe(false);
    expect(shouldNotify("all", { ...msg("x"), ts: now - 10 * 60_000 }, me, now)).toBe(false);
  });
});

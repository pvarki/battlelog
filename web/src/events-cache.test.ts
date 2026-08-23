import { describe, expect, test } from "vitest";
import { idCutoff, staleKeys } from "./events-cache.ts";

// A UUIDv7-shaped id minted at the given unix millisecond.
const uuidAt = (ms: number) => {
  const hex = ms.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-000000000000`;
};

describe("idCutoff", () => {
  test("ids minted inside the window compare fresh, older ones stale", () => {
    const now = Date.UTC(2026, 7, 23);
    const cutoff = idCutoff(now, 1000);
    expect(uuidAt(now - 500) >= cutoff).toBe(true);
    expect(uuidAt(now - 1500) >= cutoff).toBe(false);
  });

  test("clamps to zero instead of minting a negative timestamp", () => {
    expect(idCutoff(500, 1000)).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("staleKeys", () => {
  const keys = ["a", "b", "c", "d", "e"];

  test("keeps everything under both caps", () => {
    expect(staleKeys(keys, "0", 10)).toEqual([]);
  });

  test("evicts the oldest overflow beyond the row cap", () => {
    expect(staleKeys(keys, "0", 3)).toEqual(["a", "b"]);
  });

  test("evicts rows past the age cutoff", () => {
    expect(staleKeys(keys, "c", 10)).toEqual(["a", "b"]);
  });

  test("caps combine without double-evicting", () => {
    expect(staleKeys(keys, "c", 4)).toEqual(["a", "b"]);
  });
});

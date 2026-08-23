import { describe, expect, test } from "vitest";
import type { EventResponse } from "./api.ts";
import {
  CURSOR_MAX_AGE_MS,
  idCutoff,
  isCursorFresh,
  newestVersion,
  staleKeys,
} from "./events-cache.ts";

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

  test("an id minted exactly at the cutoff millisecond survives", () => {
    // The cutoff carries 0 in the version nibble where real ids carry 7, so
    // the boundary id sorts above it — inclusive, in the safe direction.
    const now = Date.UTC(2026, 7, 23);
    expect(uuidAt(now - 1000) >= idCutoff(now, 1000)).toBe(true);
  });
});

describe("isCursorFresh", () => {
  const now = Date.UTC(2026, 7, 23);

  test("accepts a cursor inside the window, rejects one past it", () => {
    expect(isCursorFresh(uuidAt(now - CURSOR_MAX_AGE_MS + 1000), now)).toBe(true);
    expect(isCursorFresh(uuidAt(now - CURSOR_MAX_AGE_MS - 1000), now)).toBe(false);
  });

  test("rejects missing values", () => {
    expect(isCursorFresh(null, now)).toBe(false);
    expect(isCursorFresh(undefined, now)).toBe(false);
    expect(isCursorFresh("", now)).toBe(false);
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

  test("exactly at the row cap evicts nothing", () => {
    expect(staleKeys(keys, "0", keys.length)).toEqual([]);
  });

  test("a key exactly at the cutoff is kept", () => {
    expect(staleKeys(keys, "c", 10)).not.toContain("c");
  });
});

describe("newestVersion", () => {
  const row = (id: string, eventId: string) => ({ id, eventId }) as EventResponse;
  const rows = [row("1", "x"), row("3", "x"), row("2", "x"), row("9", "y")];

  test("picks the highest row id of the chain", () => {
    expect(newestVersion(rows, "x")?.id).toBe("3");
  });

  test("returns undefined for an unknown chain", () => {
    expect(newestVersion(rows, "z")).toBeUndefined();
  });
});

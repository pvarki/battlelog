import { expect, test } from "vitest";
import type { TakItem } from "./cot.ts";
import { linkedTo, linkOfEvent, parseTakLink, takLinkOf } from "./links.ts";

const drone = {
  uid: "drone-1",
  type: "a-f-A-M-F-Q",
  callsign: "Hawk",
  time: 0,
  stale: 0,
  geometry: { type: "Point", coordinates: [24.9, 60.2] },
} as TakItem;

test("takLinkOf snapshots the item at a moment and parses back", () => {
  const link = takLinkOf(drone, Date.UTC(2026, 9, 14, 12));
  expect(link).toEqual({
    uid: "drone-1",
    callsign: "Hawk",
    cotType: "a-f-A-M-F-Q",
    observedAt: "2026-10-14T12:00:00.000Z",
  });
  expect(parseTakLink(link)).toEqual(link);
  expect(takLinkOf({ ...drone, callsign: undefined }, 0)).not.toHaveProperty("callsign");
});

test("parseTakLink rejects anything that isn't a link", () => {
  expect(parseTakLink(undefined)).toBeUndefined();
  expect(parseTakLink("drone-1")).toBeUndefined();
  expect(parseTakLink({ uid: "", cotType: "a", observedAt: "x" })).toBeUndefined();
  expect(parseTakLink({ uid: "a", observedAt: "x" })).toBeUndefined();
  expect(parseTakLink({ uid: "a", cotType: "a", observedAt: "x", callsign: 3 })).toEqual({
    uid: "a",
    cotType: "a",
    observedAt: "x",
  });
});

test("linkedTo queries and matches by data.tak.uid", () => {
  const { query, match } = linkedTo("drone-1");
  expect(query).toEqual({ takUid: "drone-1" });
  const linked = { data: { tak: takLinkOf(drone, 0) } };
  expect(match(linked)).toBe(true);
  expect(match({ data: { tak: { uid: "other" } } })).toBe(false);
  expect(match({ data: null })).toBe(false);
  expect(linkOfEvent(linked)?.callsign).toBe("Hawk");
});

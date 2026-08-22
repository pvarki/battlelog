import { describe, expect, it } from "vitest";
import type { EventResponse } from "./api.ts";
import { mergeEvents, relevantRows } from "./live-events.ts";

const row = (id: string, eventId: string): EventResponse =>
  ({ id, eventId, header: `h-${id}` }) as EventResponse;

describe("mergeEvents", () => {
  it("sorts newest first and dedupes by id", () => {
    const merged = mergeEvents([row("01a", "e1")], [row("01b", "e2"), row("01a", "e1")], 100);
    expect(merged.map((e) => e.id)).toEqual(["01b", "01a"]);
  });

  it("a newer version replaces its event regardless of arrival order", () => {
    const v2 = row("01c", "e1");
    expect(mergeEvents([row("01a", "e1")], [v2], 100)).toEqual([v2]);
    expect(mergeEvents([v2], [row("01a", "e1")], 100)).toEqual([v2]);
  });

  it("trims to limit, dropping the oldest", () => {
    const merged = mergeEvents([row("01a", "e1"), row("01b", "e2")], [row("01c", "e3")], 2);
    expect(merged.map((e) => e.id)).toEqual(["01c", "01b"]);
  });
});

describe("relevantRows", () => {
  it("keeps matches and new versions of shown events, drops the rest", () => {
    const current = [row("01a", "e1")];
    const incoming = [row("01b", "e1"), row("01c", "e2"), row("01d", "e3")];
    const match = (e: EventResponse) => e.eventId === "e3";
    // e1's new version passes (already shown), e2 is dropped, e3 matches.
    expect(relevantRows(current, incoming, match).map((e) => e.id)).toEqual(["01b", "01d"]);
    expect(relevantRows(current, incoming, undefined)).toEqual(incoming);
  });
});

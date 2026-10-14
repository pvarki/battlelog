import { describe, expect, it } from "vitest";
import type { TakItem } from "../cot.ts";
import { hasPosition, statusOf } from "../items.ts";
import { type KnownClient, mergeContacts, parseClients } from "./known-clients.ts";

const NOW = Date.parse("2026-10-14T12:00:00Z");

const onPicture = (uid: string) =>
  ({
    uid,
    type: "a-f-G-U-C",
    time: NOW - 1000,
    stale: NOW + 60_000,
    geometry: { type: "Point", coordinates: [24.9, 60.2] },
    callsign: `pic-${uid}`,
    team: "Cyan",
    battery: 80,
  }) as TakItem;

const client = (uid: string, connected: boolean): KnownClient => ({
  uid,
  callsign: `srv-${uid}`,
  team: "Red",
  lastEventTime: NOW - 3_600_000,
  connected,
});

describe("parseClients", () => {
  it("reads TAK's client list and drops entries without a uid or time", () => {
    const json = {
      data: [
        {
          callsign: "ALPHA",
          uid: "a",
          username: "alpha",
          team: "Cyan",
          role: "Team Member",
          lastEventTime: "2026-10-14T11:00:00Z",
          lastStatus: "Connected",
        },
        {
          callsign: "B",
          uid: "b",
          team: "",
          lastEventTime: "2026-10-14T10:00:00Z",
          lastStatus: "Disconnected",
        },
        { callsign: "no uid", lastEventTime: "2026-10-14T10:00:00Z" },
        { uid: "no time" },
      ],
    };
    expect(parseClients(json)).toEqual([
      {
        uid: "a",
        callsign: "ALPHA",
        team: "Cyan",
        role: "Team Member",
        lastEventTime: Date.parse("2026-10-14T11:00:00Z"),
        connected: true,
      },
      {
        uid: "b",
        callsign: "B",
        team: undefined,
        role: undefined,
        lastEventTime: Date.parse("2026-10-14T10:00:00Z"),
        connected: false,
      },
    ]);
    expect(parseClients({})).toEqual([]);
  });
});

describe("mergeContacts", () => {
  it("keeps the picture's copy of a user TAK also lists", () => {
    const merged = mergeContacts([onPicture("a")], [client("a", false)], "me");
    expect(merged).toEqual([onPicture("a")]);
  });

  it("adds a connected user without a position as online and unplaced", () => {
    const [added] = mergeContacts([], [client("b", true)], "me");
    expect(added?.callsign).toBe("srv-b");
    expect(added?.team).toBe("Red");
    expect(hasPosition(added as TakItem)).toBe(false);
    expect(statusOf(added as TakItem, NOW)).toBe("online");
  });

  it("adds a disconnected user as offline, last seen at their last event", () => {
    const [added] = mergeContacts([], [client("c", false)], "me");
    expect(statusOf(added as TakItem, NOW)).toBe("offline");
    expect(added?.time).toBe(NOW - 3_600_000);
  });

  it("leaves out this client and duplicate entries", () => {
    const merged = mergeContacts(
      [],
      [client("me", true), client("d", true), client("d", false)],
      "me",
    );
    expect(merged.map((c) => c.uid)).toEqual(["d"]);
    expect(merged[0]?.offline).toBeUndefined();
  });
});

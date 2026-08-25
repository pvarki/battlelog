import { describe, expect, test } from "vitest";
import type { CotEvent } from "./tak.cot.ts";
import { cotToCreateInput } from "./tak.map.ts";

const chat: CotEvent = {
  uid: "GeoChat.x.RECON.1",
  type: "b-t-f",
  time: new Date("2026-08-25T10:00:00.000Z"),
  start: new Date("2026-08-25T09:59:00.000Z"),
  stale: new Date("2026-08-25T10:05:00.000Z"),
  how: "h-g-i-g-o",
  lat: 60.1699,
  lon: 24.9384,
  hae: 12.5,
  chatRoom: "RECON",
  senderCallsign: "ALPHA-1",
  destCallsign: "RECON",
  remarks: "Two vehicles at the crossroads",
  detail: "<detail/>",
};

describe("cotToCreateInput", () => {
  test("maps a chat message", () => {
    const input = cotToCreateInput(chat);
    expect(input.header).toBe("Two vehicles at the crossroads");
    expect(input.createdBy).toBe("tak:ALPHA-1");
    expect(input.eventTime).toEqual(new Date("2026-08-25T10:00:00.000Z"));
    expect(input.inputSource).toBe("tak");
    expect(input.type).toBe("tak-chat");
    expect(input.sourceUri).toBe("tak://GeoChat.x.RECON.1/2026-08-25T10:00:00.000Z");
    expect(input.tags).toEqual(["tak", "b-t-f", "chat", "RECON"]);
    // [lng, lat] — drizzle's geometry tuple order, not the CoT attribute order
    expect(input.locationPoint).toEqual([24.9384, 60.1699]);
    expect(input.admiraltyReliability).toBeNull();
  });

  test("header is never empty, whatever the CoT carries", () => {
    // The assertion that matters most: header is NOT NULL, and most CoT is not
    // chat, so a missing fallback would fail every insert on a live stream.
    const position = cotToCreateInput({ uid: "ANDROID-x", type: "a-f-G-U-C", callsign: "BRAVO-2" });
    expect(position.header).toBe("BRAVO-2 — a-f-G-U-C");
    expect(position.type).toBe("tak-cot");

    const nameless = cotToCreateInput({ uid: "u-1", type: "a-u-G" });
    expect(nameless.header).toBe("u-1 — a-u-G");
    expect(nameless.createdBy).toBe("tak:u-1");

    const blank = cotToCreateInput({ ...chat, remarks: "   " });
    expect(blank.header).toBe("ALPHA-1 — b-t-f");
  });

  test("truncates a long body but keeps it whole in data", () => {
    const long = "x".repeat(400);
    const input = cotToCreateInput({ ...chat, remarks: long });
    expect(input.header).toHaveLength(200);
    expect(input.header.endsWith("…")).toBe(true);
    expect((input.data as { remarks: string }).remarks).toBe(long);
  });

  test("0,0 is 'no position', not the Gulf of Guinea", () => {
    expect(cotToCreateInput({ ...chat, lat: 0, lon: 0 }).locationPoint).toBeNull();
    expect(cotToCreateInput({ ...chat, lat: undefined }).locationPoint).toBeNull();
    expect(cotToCreateInput({ ...chat, lat: 91, lon: 24 }).locationPoint).toBeNull();
    // 0 on one axis alone is a real place (the Greenwich meridian)
    expect(cotToCreateInput({ ...chat, lat: 51.5, lon: 0 }).locationPoint).toEqual([0, 51.5]);
  });

  test("falls back to start when there is no time", () => {
    const input = cotToCreateInput({ ...chat, time: undefined });
    expect(input.eventTime).toEqual(new Date("2026-08-25T09:59:00.000Z"));
    expect(cotToCreateInput({ uid: "u", type: "t" }).eventTime).toBeNull();
  });
});

// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { toChange } from "../cot.ts";
import { isSendDue, newSelfSaEvent } from "./self-sa.ts";

const self = { uid: "BattleLog-Eversti", callsign: "Eversti", team: "Cyan", role: "Team Member" };
const NOW = Date.UTC(2026, 9, 13, 12);

test("a self SA is written as ATAK writes its own", () => {
  const event = newSelfSaEvent(
    { position: [25.5, 64.1], hae: 120, accuracy: 8, speed: 1.5, course: 90 },
    self,
    { os: "MacIntel", battery: 77 },
    NOW,
  );
  expect(event).toMatchObject({
    uid: "BattleLog-Eversti",
    type: "a-f-G-U-C",
    how: "m-g",
    lat: 64.1,
    lon: 25.5,
    hae: 120,
    ce: 8,
    le: 9_999_999,
    stale: NOW + 120_000,
  });
  expect(event.detail).toBe(
    '<takv device="browser" platform="BattleLog" os="MacIntel"/>' +
      '<contact endpoint="*:-1:stcp" callsign="Eversti"/>' +
      '<uid Droid="Eversti"/>' +
      '<precisionlocation geopointsrc="GPS" altsrc="GPS"/>' +
      '<__group name="Cyan" role="Team Member"/>' +
      '<status battery="77"/>' +
      '<track course="90" speed="1.5"/>',
  );
  const change = toChange(event);
  expect(change?.kind === "upsert" && change.item).toMatchObject({
    callsign: "Eversti",
    team: "Cyan",
    role: "Team Member",
    battery: 77,
    speed: 1.5,
    course: 90,
  });
});

test("without altitude or battery the report says so", () => {
  const event = newSelfSaEvent({ position: [25, 64], accuracy: 30 }, self, { os: "x" }, NOW);
  expect(event.hae).toBe(9_999_999);
  expect(event.detail).toContain('altsrc="???"');
  expect(event.detail).not.toContain("<status");
  expect(event.detail).toContain('<track course="0" speed="0"/>');
});

test("reports are paced every 5 s while moving and 30 s while still", () => {
  const here: [number, number] = [25, 64];
  const moved: [number, number] = [25, 64.001];
  const last = { position: here, time: NOW };
  expect(isSendDue(undefined, here, NOW)).toBe(true);
  expect(isSendDue(last, moved, NOW + 4_000)).toBe(false);
  expect(isSendDue(last, moved, NOW + 5_000)).toBe(true);
  expect(isSendDue(last, here, NOW + 29_000)).toBe(false);
  expect(isSendDue(last, here, NOW + 30_000)).toBe(true);
});

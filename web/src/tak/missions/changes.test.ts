// @vitest-environment happy-dom
import { expect, test } from "vitest";
import type { CotEvent } from "../protocol/cot-event.ts";
import { parseMissionChanges } from "./changes.ts";

const notice = (detail: string): CotEvent =>
  ({ uid: "n", type: "t-x-m-c", detail }) as unknown as CotEvent;

test("a content change names the mission, the change and the item", () => {
  // As the dev TAK sent it to a subscriber.
  const detail = `<mission type="CHANGE" tool="public" name="RECON" guid="g" authorUid="BattleLog-Probe2"><MissionChanges><MissionChange><contentUid>2dc320b2</contentUid><creatorUid>BattleLog-Probe2</creatorUid><isFederatedChange>false</isFederatedChange><missionGuid>g</missionGuid><missionName>RECON</missionName><timestamp>2026-10-14T06:43:41.975Z</timestamp><type>REMOVE_CONTENT</type><details type="a-u-G" callsign="Auto"/></MissionChange></MissionChanges></mission>`;
  expect(parseMissionChanges(notice(detail))).toEqual([
    { mission: "RECON", type: "REMOVE_CONTENT", uid: "2dc320b2" },
  ]);
});

test("a notice without listed changes still says which mission moved", () => {
  expect(parseMissionChanges(notice(`<mission type="CREATE" name="NEW"/>`))).toEqual([
    { mission: "NEW", type: "CREATE" },
  ]);
  expect(parseMissionChanges(notice("<other/>"))).toEqual([]);
});

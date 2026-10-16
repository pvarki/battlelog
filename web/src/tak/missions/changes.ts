import type { CotEvent } from "../protocol/cot-event.ts";

/**
 * TAK's mission change notices (`t-x-m-c`), sent to a mission's subscribers
 * over the stream: what was added to or removed from which mission.
 */

export const MISSION_CHANGE_TYPE = "t-x-m-c";

export type MissionChange = {
  mission: string;
  /** TAK's change type: ADD_CONTENT, REMOVE_CONTENT, CREATE_MISSION, … */
  type: string;
  /** The map item it concerns; files carry a hash instead. */
  uid?: string;
};

const text = (parent: Element, tag: string) =>
  parent.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;

/** The changes a notice carries; one for the mission itself when it lists none. */
export const parseMissionChanges = (event: CotEvent): MissionChange[] => {
  const doc = new DOMParser().parseFromString(
    `<detail>${event.detail}</detail>`,
    "application/xml",
  );
  const mission = doc.getElementsByTagName("mission")[0];
  const name = mission?.getAttribute("name");
  if (!mission || !name) return [];
  const changes = Array.from(mission.getElementsByTagName("MissionChange"));
  if (changes.length === 0) return [{ mission: name, type: mission.getAttribute("type") ?? "" }];
  return changes.map((change) => ({
    mission: text(change, "missionName") ?? name,
    type: text(change, "type") ?? "",
    uid: text(change, "contentUid"),
  }));
};

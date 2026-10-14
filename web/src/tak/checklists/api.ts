import type { Sender } from "../identity.ts";
import { MISSION_CHANGE_TYPE, parseMissionChanges } from "../missions/changes.ts";
import type { MissionFile } from "../missions/missions.ts";
import { fetchMission } from "../missions/missions.ts";
import type { CotEvent } from "../protocol/cot-event.ts";
import { takGetText, takSend } from "../rest.ts";
import {
  type Checklist,
  type ChecklistTask,
  parseChecklist,
  parseChecklists,
  taskWithStatus,
  templateXml,
} from "./excheck.ts";

const EXCHECK = "/Marti/api/excheck";
const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** Templates are the files of TAK's `exchecktemplates` Data Sync feed, filed under their uid. */
export const fetchTemplates = async () => (await fetchMission("exchecktemplates"))?.files ?? [];

/** TAK files a template under its uid; its name is the first keyword. */
export const templateName = (file: MissionFile) => file.keywords[0] || file.name;

export const fetchChecklist = async (uid: string): Promise<Checklist> =>
  parseChecklist(await takGetText(`${EXCHECK}/checklist/${encodeURIComponent(uid)}`));

/** Active checklists with their tasks; TAK lists only their details, so each is fetched whole. */
export const fetchActiveChecklists = async (clientUid: string | undefined) => {
  const params = clientUid ? `?${query({ clientUid })}` : "";
  const listed = parseChecklists(await takGetText(`${EXCHECK}/checklist/active${params}`));
  return Promise.all(listed.map((c) => fetchChecklist(c.uid).catch(() => c)));
};

export const createTemplate = (
  sender: Sender,
  template: { name: string; description: string; tasks: string[] },
) =>
  takSend({
    method: "POST",
    path: `${EXCHECK}/template?${query({ clientUid: sender.uid, callsign: sender.callsign, name: template.name, description: template.description })}`,
    xml: templateXml({ ...template, creatorUid: sender.uid, creatorCallsign: sender.callsign }),
  });

/** Starts a checklist from a template and returns it. */
export const startChecklist = async (
  sender: Sender,
  templateUid: string,
  name: string,
): Promise<Checklist> => {
  const params = query({
    clientUid: sender.uid,
    callsign: sender.callsign,
    name,
    description: "",
    startTime: new Date().toISOString(),
    defaultRole: "MISSION_SUBSCRIBER",
  });
  const xml = await takSend({
    method: "POST",
    path: `${EXCHECK}/${encodeURIComponent(templateUid)}/start?${params}`,
  });
  return parseChecklist(xml);
};

export const setTaskComplete = (
  sender: Sender,
  checklistUid: string,
  task: ChecklistTask,
  complete: boolean,
) =>
  takSend({
    method: "PUT",
    path: `${EXCHECK}/checklist/${encodeURIComponent(checklistUid)}/task/${encodeURIComponent(task.uid)}?${query({ clientUid: sender.uid })}`,
    xml: taskWithStatus(task, complete, sender.callsign, new Date()),
  });

// Without clientUid TAK answers 200 but leaves the checklist active (verified on 5.8).
export const stopChecklist = (sender: Sender, uid: string) =>
  takSend({
    method: "POST",
    path: `${EXCHECK}/${encodeURIComponent(uid)}/stop?${query({ clientUid: sender.uid })}`,
  });

const listeners = new Set<(missions: string[]) => void>();

/** Calls `listener` with the missions a TAK change notice names; none when it names none. */
export const onChecklistChange = (listener: (missions: string[]) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** A checklist is a mission named by its uid, so its changes come as mission change notices. */
export const receiveChecklistChange = (event: CotEvent) => {
  if (listeners.size === 0 || !event.type.startsWith(MISSION_CHANGE_TYPE)) return;
  const missions = parseMissionChanges(event).map((c) => c.mission);
  for (const listener of listeners) listener(missions);
};

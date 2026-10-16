import { escapeXml } from "../protocol/cot-xml.ts";

/** ATAK's ExCheck checklists as TAK Server stores them: XML, with one value per column on each task. */

export type ChecklistColumn = { name: string; type: string };

export type ChecklistTask = {
  uid: string;
  values: string[];
  /** Pending, Complete, Complete (late) or Late. */
  status: string;
  notes?: string;
  completeBy?: string;
  completeDTG?: string;
  /** A section heading row, not a task to do. */
  lineBreak: boolean;
  lineBreakText?: string;
  /** As TAK sent it: a task is written back whole, keeping fields BattleLog doesn't show. */
  xml: string;
};

export type Checklist = {
  uid: string;
  name: string;
  description?: string;
  startTime?: string;
  templateName?: string;
  creatorUid?: string;
  creatorCallsign?: string;
  columns: ChecklistColumn[];
  tasks: ChecklistTask[];
};

const childText = (parent: Element, tag: string) =>
  Array.from(parent.children)
    .find((c) => c.tagName === tag)
    ?.textContent?.trim() || undefined;

const parseXml = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0)
    throw new Error("TAK sent checklist XML that doesn't parse");
  return doc;
};

const parseTask = (el: Element): ChecklistTask => ({
  uid: childText(el, "uid") ?? "",
  values: Array.from(el.children)
    .filter((c) => c.tagName === "value")
    .map((c) => c.textContent ?? ""),
  status: childText(el, "status") ?? "Pending",
  notes: childText(el, "notes"),
  completeBy: childText(el, "completeBy"),
  completeDTG: childText(el, "completeDTG"),
  lineBreak: childText(el, "lineBreak") === "true",
  lineBreakText: childText(el, "lineBreakText"),
  xml: new XMLSerializer().serializeToString(el),
});

const parseChecklistElement = (el: Element): Checklist => {
  const details = el.getElementsByTagName("checklistDetails")[0];
  const detail = (tag: string) => (details ? childText(details, tag) : undefined);
  return {
    uid: detail("uid") ?? "",
    name: detail("name") ?? "",
    description: detail("description"),
    startTime: detail("startTime"),
    templateName: detail("templateName"),
    creatorUid: detail("creatorUid"),
    creatorCallsign: detail("creatorCallsign"),
    columns: Array.from(el.getElementsByTagName("checklistColumn")).map((c) => ({
      name: childText(c, "columnName") ?? "",
      type: childText(c, "columnType") ?? "ShortString",
    })),
    tasks: Array.from(el.getElementsByTagName("checklistTask")).map(parseTask),
  };
};

/** One `<checklist>`, a checklist or a template. */
export const parseChecklist = (xml: string): Checklist => {
  const el = parseXml(xml).getElementsByTagName("checklist")[0];
  if (!el) throw new Error("TAK sent no checklist");
  return parseChecklistElement(el);
};

/** The `<checklists>` TAK lists active checklists in. */
export const parseChecklists = (xml: string): Checklist[] =>
  xml.trim()
    ? Array.from(parseXml(xml).getElementsByTagName("checklist")).map(parseChecklistElement)
    : [];

export const isComplete = (task: ChecklistTask) => task.status.startsWith("Complete");
export const isLate = (task: ChecklistTask) => /late/i.test(task.status);

export const progress = (checklist: Checklist) => {
  const tasks = checklist.tasks.filter((t) => !t.lineBreak);
  return { done: tasks.filter(isComplete).length, total: tasks.length };
};

/**
 * The task as TAK should store it after being ticked or unticked. TAK itself
 * decides whether a completion was late, so only Pending and Complete are set.
 */
export const taskWithStatus = (
  task: ChecklistTask,
  complete: boolean,
  by: string,
  at: Date,
): string => {
  const el = parseXml(task.xml).documentElement;
  const setChild = (tag: string, value: string | undefined) => {
    const existing = Array.from(el.children).find((c) => c.tagName === tag);
    if (value === undefined) return existing?.remove();
    const child = existing ?? el.appendChild(el.ownerDocument.createElementNS(null, tag));
    child.textContent = value;
  };
  setChild("status", complete ? "Complete" : "Pending");
  setChild("completeBy", complete ? by : undefined);
  setChild("completeDTG", complete ? at.toISOString() : undefined);
  return new XMLSerializer().serializeToString(el);
};

const tag = (name: string, value: string) => `<${name}>${escapeXml(value)}</${name}>`;

/** A template with one task per non-empty line, in a single "Task" column. */
export const templateXml = ({
  name,
  description,
  tasks,
  creatorUid,
  creatorCallsign,
}: {
  name: string;
  description: string;
  tasks: string[];
  creatorUid: string;
  creatorCallsign: string;
}): string => {
  const rows = tasks.map((text, i) =>
    [
      "<checklistTask>",
      tag("lineBreak", "false"),
      tag("number", String(i + 1)),
      tag("uid", crypto.randomUUID()),
      tag("value", text),
      "</checklistTask>",
    ].join(""),
  );
  return [
    "<checklist><checklistDetails>",
    tag("name", name),
    tag("uid", crypto.randomUUID()),
    tag("description", description),
    tag("creatorUid", creatorUid),
    tag("creatorCallsign", creatorCallsign),
    "</checklistDetails><checklistColumns><checklistColumn>",
    tag("columnName", "Task"),
    tag("columnType", "ShortString"),
    tag("columnWidth", "300"),
    tag("columnEditable", "false"),
    "</checklistColumn></checklistColumns>",
    `<checklistTasks>${rows.join("")}</checklistTasks></checklist>`,
  ].join("");
};

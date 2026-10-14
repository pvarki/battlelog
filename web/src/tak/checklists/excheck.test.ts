// @vitest-environment happy-dom
import { expect, test } from "vitest";
import {
  type ChecklistTask,
  isLate,
  parseChecklist,
  parseChecklists,
  progress,
  taskWithStatus,
  templateXml,
} from "./excheck.ts";

const CHECKLIST = `<checklist>
<checklistDetails><name>Morning</name><uid>c1</uid><description>Daily</description>
<startTime>2026-10-14T06:00:00.000Z</startTime><templateName>Routine</templateName>
<creatorUid>BattleLog-Alpha</creatorUid><creatorCallsign>Alpha-BL</creatorCallsign>
<missions><mission>c1</mission></missions></checklistDetails>
<checklistColumns>
<checklistColumn><columnName>Task</columnName><columnType>ShortString</columnType><columnEditable>false</columnEditable></checklistColumn>
<checklistColumn><columnName>Due</columnName><columnType>RelativeTime</columnType></checklistColumn>
</checklistColumns>
<checklistTasks>
<checklistTask><lineBreak>true</lineBreak><uid>h</uid><lineBreakText>Vehicles</lineBreakText></checklistTask>
<checklistTask><lineBreak>false</lineBreak><number>1</number><uid>t1</uid><value>Fuel &amp; oil</value><value>00:30</value><status>Complete</status><completeBy>Bravo</completeBy><completeDTG>2026-10-14T06:10:00.000Z</completeDTG></checklistTask>
<checklistTask><lineBreak>false</lineBreak><number>2</number><uid>t2</uid><value>Radios</value><value/><status>Late</status><notes>Spare battery</notes><dueDTG>2026-10-14T06:30:00.000Z</dueDTG></checklistTask>
<checklistTask><lineBreak>false</lineBreak><number>3</number><uid>t3</uid><value>Comms check</value><value/></checklistTask>
</checklistTasks></checklist>`;

const task = (index: number): ChecklistTask => {
  const found = parseChecklist(CHECKLIST).tasks[index];
  if (!found) throw new Error(`no task ${index}`);
  return found;
};

const readTask = (xml: string) =>
  parseChecklist(`<checklist><checklistTasks>${xml}</checklistTasks></checklist>`).tasks[0];

test("a checklist reads with its details, columns and tasks", () => {
  const checklist = parseChecklist(CHECKLIST);
  expect(checklist).toMatchObject({
    uid: "c1",
    name: "Morning",
    templateName: "Routine",
    creatorUid: "BattleLog-Alpha",
    columns: [
      { name: "Task", type: "ShortString" },
      { name: "Due", type: "RelativeTime" },
    ],
  });
  expect(checklist.tasks.map((t) => [t.uid, t.status, t.values])).toEqual([
    ["h", "Pending", []],
    ["t1", "Complete", ["Fuel & oil", "00:30"]],
    ["t2", "Late", ["Radios", ""]],
    ["t3", "Pending", ["Comms check", ""]],
  ]);
  expect(task(0)).toMatchObject({ lineBreak: true, lineBreakText: "Vehicles" });
  expect(task(2).notes).toBe("Spare battery");
  expect(isLate(task(2))).toBe(true);
  expect(isLate(task(1))).toBe(false);
});

test("progress counts tasks, not section headings", () => {
  expect(progress(parseChecklist(CHECKLIST))).toEqual({ done: 1, total: 3 });
});

test("the active list reads every checklist; an empty answer is none", () => {
  const second = CHECKLIST.replace("<uid>c1</uid>", "<uid>c2</uid>");
  expect(
    parseChecklists(`<checklists>${CHECKLIST}${second}</checklists>`).map((c) => c.uid),
  ).toEqual(["c1", "c2"]);
  expect(parseChecklists("")).toEqual([]);
  expect(() => parseChecklists("<checklists>")).toThrow();
});

test("completing a task keeps its other fields and says who and when", () => {
  const xml = taskWithStatus(task(3), true, "Alpha-BL", new Date("2026-10-14T07:00:00.000Z"));
  expect(readTask(xml)).toMatchObject({
    uid: "t3",
    values: ["Comms check", ""],
    status: "Complete",
    completeBy: "Alpha-BL",
    completeDTG: "2026-10-14T07:00:00.000Z",
  });
  expect(xml).toContain("<number>3</number>");
});

test("reopening a task clears its completion", () => {
  expect(readTask(taskWithStatus(task(1), false, "Alpha-BL", new Date()))).toMatchObject({
    status: "Pending",
    completeBy: undefined,
    completeDTG: undefined,
  });
});

test("a template has one Task column and one task per line", () => {
  const template = parseChecklist(
    templateXml({
      name: "Patrol <prep>",
      description: "Before leaving",
      tasks: ["Water", "Maps & compass"],
      creatorUid: "BattleLog-Alpha",
      creatorCallsign: "Alpha-BL",
    }),
  );
  expect(template).toMatchObject({
    name: "Patrol <prep>",
    description: "Before leaving",
    columns: [{ name: "Task", type: "ShortString" }],
  });
  expect(template.uid).not.toBe("");
  expect(template.tasks.map((t) => t.values)).toEqual([["Water"], ["Maps & compass"]]);
  expect(new Set(template.tasks.map((t) => t.uid)).size).toBe(2);
});

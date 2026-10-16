// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, type TakItem, toChange } from "./cot.ts";
import { describeStep, UNDO_DEPTH, type UndoStep, undoEvents, withStep } from "./undo.ts";

const marker = (uid: string, lat: number): CotEvent => ({
  uid,
  type: "a-h-G",
  how: "h-g-i-g-o",
  time: 1_000,
  start: 1_000,
  stale: 2_000,
  lat,
  lon: 22,
  hae: 9999999,
  ce: 9999999,
  le: 9999999,
  detail: `<contact callsign="${uid}"/>`,
});

const itemOf = (event: CotEvent): TakItem => {
  const change = toChange(event);
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  return change.item;
};

const anything = () => true;

test("undoing an edit re-issues the earlier version now, so it supersedes the edit", () => {
  const before = itemOf(marker("v1", 60));
  const step: UndoStep = { changes: [{ before, after: marker("v1", 61) }] };
  const [event] = undoEvents(step, anything, 9_000);
  expect(event).toMatchObject({ uid: "v1", type: "a-h-G", lat: 60, time: 9_000, start: 9_000 });
  expect(event?.stale).toBeGreaterThan(9_000);
});

test("undoing a create deletes the created item", () => {
  const step: UndoStep = { changes: [{ before: undefined, after: marker("new", 60) }] };
  expect(undoEvents(step, anything, 9_000)).toMatchObject([{ uid: "new", type: "t-x-d-d" }]);
});

test("undoing a delete sends the deleted item back", () => {
  const before = itemOf(marker("gone", 60));
  const deleted = { ...marker("gone", 0), type: "t-x-d-d", detail: "<__forcedelete/>" };
  const step: UndoStep = { changes: [{ before, after: deleted }] };
  expect(undoEvents(step, anything, 9_000)).toMatchObject([
    { uid: "gone", type: "a-h-G", lat: 60 },
  ]);
});

test("undo leaves alone the items the user may not change", () => {
  const step: UndoStep = {
    changes: [
      { before: itemOf(marker("mine", 60)), after: marker("mine", 61) },
      { before: itemOf(marker("theirs", 60)), after: marker("theirs", 61) },
    ],
  };
  const events = undoEvents(step, (item) => item.uid === "mine");
  expect(events.map((e) => e.uid)).toEqual(["mine"]);
});

test("the stack keeps only the latest steps", () => {
  let steps: UndoStep[] = [];
  for (let i = 0; i < UNDO_DEPTH + 5; i++)
    steps = withStep(steps, { changes: [{ before: undefined, after: marker(`m${i}`, 60) }] });
  expect(steps).toHaveLength(UNDO_DEPTH);
  expect(describeStep(steps.at(-1) as UndoStep)).toBe(`m${UNDO_DEPTH + 4}`);
});

test("a step is named after its item, or by how many items it changed", () => {
  const step: UndoStep = {
    changes: [
      { before: itemOf(marker("a", 60)), after: marker("a", 61) },
      { before: undefined, after: marker("b", 60) },
    ],
  };
  expect(describeStep(step)).toBe("2 items");
});

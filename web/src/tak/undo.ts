import { deleteEvent, editEvent } from "./commands.ts";
import { type CotEvent, type TakItem, toChange } from "./cot.ts";
import { labelOf } from "./items.ts";

/**
 * Undo for changes made in this session. TAK keeps no history, so undoing
 * writes again: an item's earlier version is re-issued now so it supersedes
 * the change, and an item the change created is deleted.
 */

export const UNDO_DEPTH = 50;

/**
 * What one action wrote, each write beside its item as it was before; no
 * `before` for an item it created. `planId` is the plan the writes went into,
 * absent when they went straight to TAK.
 */
export type UndoStep = {
  planId?: string;
  changes: { before: TakItem | undefined; after: CotEvent }[];
};

export const withStep = (steps: readonly UndoStep[], step: UndoStep): UndoStep[] =>
  [...steps, step].slice(-UNDO_DEPTH);

const createdItem = (event: CotEvent) => {
  const change = toChange(event);
  return change?.kind === "upsert" ? change.item : undefined;
};

/** The items a step changed, as they were or as it created them. */
const subjectsOf = (step: UndoStep): TakItem[] =>
  step.changes.flatMap(({ before, after }) => before ?? createdItem(after) ?? []);

export const describeStep = (step: UndoStep): string => {
  const subjects = subjectsOf(step);
  return subjects.length === 1 ? labelOf(subjects[0] as TakItem) : `${subjects.length} items`;
};

/** The writes that put the step's items back as they were, leaving alone the ones `canChange` refuses. */
export const undoEvents = (
  step: UndoStep,
  canChange: (item: TakItem) => boolean,
  now = Date.now(),
): CotEvent[] =>
  step.changes.flatMap(({ before, after }) => {
    if (before) return canChange(before) ? [editEvent(before, () => {}, now)] : [];
    const created = createdItem(after);
    return created && canChange(created) ? [deleteEvent(created, now)] : [];
  });

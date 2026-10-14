import { useState } from "react";
import { publish } from "./commands.ts";
import { type CotEvent, type TakItem, toChange } from "./cot.ts";
import { addToPlan, draftOf, type Plan, removeFromPlan } from "./plans/plans.ts";
import { type TakStatus, takStore } from "./session.ts";
import { type UndoStep, undoEvents, withStep } from "./undo.ts";

/** Changes to TAK items, into the active plan or straight to TAK, and undoing them. */
export const useTakWrites = ({
  activePlan,
  plans,
  liveItems,
  missionItem,
  replaying,
  replayReason,
  callsign,
  connection,
}: {
  activePlan: Plan | undefined;
  plans: Plan[];
  liveItems: TakItem[];
  missionItem: (uid: string) => TakItem | undefined;
  replaying: boolean;
  replayReason: string | undefined;
  callsign: string | null | undefined;
  connection: TakStatus["connection"];
}) => {
  /** Where new items and changes go: the active plan, or straight to TAK. */
  const send = (event: CotEvent) => {
    if (!activePlan) return void publish(event);
    const existing = liveItems.find((i) => i.uid === event.uid) ?? missionItem(event.uid);
    const planned = activePlan.entries.some((e) => e.event.uid === event.uid);
    // Deleting an item that exists only in the plan just drops its draft.
    if (toChange(event)?.kind === "delete" && !existing && planned)
      return removeFromPlan(activePlan, event.uid);
    addToPlan(activePlan, { event, basedOn: existing?.time });
  };
  const [undoSteps, setUndoSteps] = useState<UndoStep[]>([]);
  /** Sends one action's writes and remembers how to take them back. */
  const submitAll = (events: CotEvent[]) => {
    if (events.length === 0 || replaying) return;
    // From the store and the stored plan: two quick changes would both see the last render's state.
    const changes = events.map((after) => {
      const draft = activePlan ? (draftOf(activePlan, after.uid) ?? null) : undefined;
      const drafted = draft && toChange(draft.event);
      const before =
        (drafted?.kind === "upsert" ? drafted.item : undefined) ??
        takStore.get(after.uid) ??
        missionItem(after.uid);
      return { before, after, draft };
    });
    setUndoSteps((steps) => withStep(steps, { planId: activePlan?.id, changes }));
    for (const event of events) send(event);
  };
  const submit = (event: CotEvent) => submitAll([event]);
  const readOnlyReason = (item: TakItem) => {
    if (replayReason) return replayReason;
    if (item.team) return "A TAK user's own position comes from their device";
    if (!callsign) return "No callsign: open BattleLog from the deploy app to change TAK items";
    if (!activePlan && connection !== "live") return "Not connected to TAK";
  };
  const canChange = (item: TakItem) => !readOnlyReason(item);
  const latestStep = undoSteps.at(-1);
  const undoReason = replayReason
    ? replayReason
    : !callsign
      ? "No callsign: open BattleLog from the deploy app to change TAK items"
      : latestStep && latestStep.planId !== activePlan?.id
        ? latestStep.planId
          ? `The latest change went into plan ${plans.find((p) => p.id === latestStep.planId)?.name ?? "(deleted)"}: make it active to undo it`
          : "The latest change went straight to TAK: switch to Live to undo it"
        : !activePlan && connection !== "live"
          ? "Not connected to TAK"
          : undefined;
  const undo = () => {
    if (!latestStep || undoReason) return;
    setUndoSteps(undoSteps.slice(0, -1));
    if (latestStep.planId && activePlan) {
      // A plan's undo puts its drafts back as they were; re-staging old versions would publish them.
      for (const { before, after, draft } of latestStep.changes) {
        if (before && !canChange(before)) continue;
        if (draft) addToPlan(activePlan, draft);
        else removeFromPlan(activePlan, after.uid);
      }
      return;
    }
    for (const event of undoEvents(latestStep, canChange)) send(event);
  };
  return { submitAll, submit, readOnlyReason, canChange, latestStep, undoReason, undo };
};

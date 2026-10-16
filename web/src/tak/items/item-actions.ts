import type { TakItem } from "../cot.ts";
import { sidcOf, type UnitStatus, unitStatusOf } from "../items.ts";

/** A unit's 2525 status; undefined for people, shapes and anything else that isn't a unit. */
export const unitStatusOfItem = (item: TakItem): UnitStatus | undefined =>
  item.type.startsWith("a-") && !item.team ? unitStatusOf(sidcOf(item) ?? "") : undefined;

/** A single point, not an ellipse: it can be moved, and where it has been is a track. */
export const isPointItem = (item: TakItem) => item.geometry.type === "Point" && !item.ellipse;

export type ActionContext = {
  /** Why the item can't be changed from here, or undefined when it can. */
  readOnlyReason: string | undefined;
  /** The user's callsign, which uploads are credited to. */
  callsign: string | null | undefined;
  /** Edits are staged in a plan; photos go straight to TAK, so they wait for it to close. */
  planActive: boolean;
  /** Who this browser writes to TAK as; undefined without a callsign. */
  clientUid: string | undefined;
  /** How many missions (Data Sync feeds) the item could be added to. */
  missionCount: number;
};

/** What the details panel offers for an item. Plan drafts exist only in this browser, so nothing that reaches TAK applies to them. */
export const itemActions = (item: TakItem, ctx: ActionContext) => {
  const writable = !ctx.readOnlyReason;
  const unitStatus = unitStatusOfItem(item);
  const actions = {
    edit: writable,
    send: !item.draft,
    addToFeed: !!ctx.clientUid && !item.draft && ctx.missionCount > 0,
    attachPhoto: !!ctx.callsign && writable && !ctx.planActive && !item.draft,
    log: !item.draft,
    exportTrack: isPointItem(item) && !item.draft,
    markDestroyed: !!unitStatus && writable && unitStatus !== "destroyed",
    delete: writable,
  };
  return {
    ...actions,
    /** Whether the More menu has anything in it. */
    more:
      actions.addToFeed ||
      actions.attachPhoto ||
      actions.log ||
      actions.exportTrack ||
      actions.markDestroyed ||
      actions.delete,
  };
};

export type ItemActions = ReturnType<typeof itemActions>;

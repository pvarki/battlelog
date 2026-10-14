import { editEvent, ensureChild } from "./commands.ts";
import type { CotEvent, TakItem } from "./cot.ts";
import { sendDataPackage } from "./datapackage.ts";
import type { Sender } from "./identity.ts";
import { exportPlan, type Plan, reissuePlan, safeZipName } from "./plans/plans.ts";
import { childNamed } from "./protocol/cot-event.ts";
import { sendCot } from "./session.ts";

/**
 * ATAK's "Send": an item or a whole plan delivered to chosen TAK users only.
 * TAK Server routes an event carrying `<marti><dest callsign>` to those
 * contacts instead of broadcasting it, so nobody else's copy changes.
 */

/** Replaces any earlier addressing, so the event reaches only `callsigns`. */
export const setRecipients = (detail: Element, callsigns: string[]) => {
  childNamed(detail, "marti")?.remove();
  const marti = ensureChild(detail, "marti");
  for (const callsign of callsigns) {
    const dest = detail.ownerDocument.createElementNS(null, "dest");
    dest.setAttribute("callsign", callsign);
    marti.appendChild(dest);
  }
};

/** The item's latest event re-issued now and addressed to `callsigns`; the rest of its detail as it arrived. */
export const addressedEvent = (item: TakItem, callsigns: string[], now = Date.now()): CotEvent =>
  editEvent(item, (detail) => setRecipients(detail, callsigns), now);

/** The addressed copy isn't applied here: it would carry its recipients into the next ordinary edit. */
export const sendItem = (item: TakItem, callsigns: string[]) => {
  if (!sendCot(addressedEvent(item, callsigns), { local: false }))
    throw new Error("Not connected to TAK");
};

/** The plan as a data package for `callsigns`; ATAK imports its items on receipt. */
export const sendPlan = async (plan: Plan, sender: Sender, callsigns: string[]) => {
  const zip = new Uint8Array(await exportPlan(reissuePlan(plan)).arrayBuffer());
  await sendDataPackage(zip, `${safeZipName(plan.name)}.zip`, plan.name, sender, callsigns);
};

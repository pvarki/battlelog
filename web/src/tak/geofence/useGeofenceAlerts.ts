import { notifications } from "@mantine/notifications";
import { useEffect, useRef, useState } from "react";
import type { TakItem } from "../cot.ts";
import { takSender } from "../identity.ts";
import { type Crossing, checkFences, describeCrossing, type FenceState } from "./geofence.ts";

export type FenceAlert = Crossing & { id: string };

const MAX_ALERTS = 20;

/**
 * Watches the live picture's tracked fences, as ATAK does on the device:
 * each crossing raises a notification and joins the alert list until dismissed.
 * Fences the user drew, here or from their ATAK, are watched first.
 */
export const useGeofenceAlerts = (items: TakItem[], callsign: string | null | undefined) => {
  const state = useRef<FenceState>(new Map());
  const [alerts, setAlerts] = useState<FenceAlert[]>([]);
  const [unwatched, setUnwatched] = useState(0);
  const [dismissedReceived, setDismissedReceived] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const own = callsign ? [callsign, takSender(callsign).callsign] : [];
    const isOwn = (fence: TakItem) => !!fence.creator && own.includes(fence.creator);
    const checked = checkFences(state.current, items, Date.now(), isOwn);
    state.current = checked.state;
    setUnwatched(checked.unwatched);
    if (checked.crossings.length === 0) return;
    for (const crossing of checked.crossings)
      notifications.show({
        color: "warning",
        title: "Geofence",
        message: describeCrossing(crossing),
      });
    const raised = checked.crossings.map((c) => ({ ...c, id: crypto.randomUUID() }));
    setAlerts((current) => [...raised, ...current].slice(0, MAX_ALERTS));
  }, [items, callsign]);

  // A received alert re-sent later under the same uid is a new one, so it shows again.
  const receivedKey = (item: TakItem) => `${item.uid} ${item.time}`;
  return {
    alerts,
    /** Tracking fences past the watch limit, which raise no alerts here. */
    unwatched,
    dismiss: (id: string) => setAlerts((current) => current.filter((a) => a.id !== id)),
    isDismissed: (item: TakItem) => dismissedReceived.has(receivedKey(item)),
    dismissReceived: (item: TakItem) =>
      setDismissedReceived((current) => new Set(current).add(receivedKey(item))),
  };
};

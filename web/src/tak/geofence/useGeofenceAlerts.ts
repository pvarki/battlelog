import { notifications } from "@mantine/notifications";
import { useEffect, useRef, useState } from "react";
import type { TakItem } from "../cot.ts";
import { type Crossing, checkFences, describeCrossing, type FenceState } from "./geofence.ts";

export type FenceAlert = Crossing & { id: string };

const MAX_ALERTS = 20;

/**
 * Watches the live picture's tracked fences, as ATAK does on the device:
 * each crossing raises a notification and joins the alert list until dismissed.
 */
export const useGeofenceAlerts = (items: TakItem[]) => {
  const state = useRef<FenceState>(new Map());
  const [alerts, setAlerts] = useState<FenceAlert[]>([]);
  const [dismissedReceived, setDismissedReceived] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const checked = checkFences(state.current, items, Date.now());
    state.current = checked.state;
    if (checked.crossings.length === 0) return;
    for (const crossing of checked.crossings)
      notifications.show({
        color: "warning",
        title: "Geofence",
        message: describeCrossing(crossing),
      });
    const raised = checked.crossings.map((c) => ({ ...c, id: crypto.randomUUID() }));
    setAlerts((current) => [...raised, ...current].slice(0, MAX_ALERTS));
  }, [items]);

  // A received alert re-sent later under the same uid is a new one, so it shows again.
  const receivedKey = (item: TakItem) => `${item.uid} ${item.time}`;
  return {
    alerts,
    dismiss: (id: string) => setAlerts((current) => current.filter((a) => a.id !== id)),
    isDismissed: (item: TakItem) => dismissedReceived.has(receivedKey(item)),
    dismissReceived: (item: TakItem) =>
      setDismissedReceived((current) => new Set(current).add(receivedKey(item))),
  };
};

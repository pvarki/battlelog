import { IconBellRinging } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import {
  type Alert,
  DISMISS_EVENT_TYPE,
  matchesAlert,
  type RaisedAlert,
  raisedKey,
} from "../../alerts.ts";
import type { EventResponse } from "../../api.ts";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

const configSchema = z
  .object({
    ...baseWidgetConfig,
    /** How many recent events the rules are checked against. */
    lookback: z.number().int().min(20).max(1000).default(200),
    /** Keep dismissed alerts visible, struck through, instead of hiding them. */
    showDismissed: z.boolean().default(false),
  })
  .strict();

export type AlertsConfig = z.infer<typeof configSchema>;

/**
 * Every alert the given rules raise over the given events, newest first.
 *
 * One event can raise several rules and each pairing is its own entry: two rules
 * both firing on one message is two things for someone to acknowledge, not one.
 */
export const raisedAlerts = (
  events: readonly EventResponse[],
  rules: readonly { alert: Alert; source: string }[],
): RaisedAlert[] => {
  const raised: RaisedAlert[] = [];
  for (const event of events) {
    if (event.type === DISMISS_EVENT_TYPE) continue;
    for (const { alert, source } of rules) {
      if (matchesAlert(event, alert)) {
        raised.push({ key: raisedKey(alert.id, event.id), alert, event, source });
      }
    }
  }
  return raised.sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt));
};

const descriptor: WidgetDescriptor<AlertsConfig> = {
  type: "alerts",
  Icon: IconBellRinging,
  name: "Alerts",
  description: "Alerts raised by any board's rules, with acknowledgement",
  configSchema,
  defaultConfig: { lookback: 200, showDismissed: false },
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 6, h: 3 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

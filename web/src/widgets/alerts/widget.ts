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

/**
 * Which open alerts have not been announced yet, given what already has been.
 *
 * Pulled out of the view so the behaviour that matters — the card unfolds for
 * something that happened while you were watching, and not for the backlog it
 * loaded with — is testable without a DOM.
 *
 * `announced` of null means nothing has been counted yet: that first call
 * records the backlog and reports nothing fresh, which is what stops a board
 * from unfolding on every page load.
 */
export const freshAlertKeys = (
  openKeys: readonly string[],
  announced: Set<string> | null,
): string[] => {
  if (announced === null) return [];
  return openKeys.filter((k) => !announced.has(k));
};

const descriptor: WidgetDescriptor<AlertsConfig> = {
  type: "alerts",
  Icon: IconBellRinging,
  name: "Alerts",
  description: "Alerts raised by any board's rules, with acknowledgement",
  configSchema,
  defaultConfig: { lookback: 200 },
  // Folded it is one line, but the tile also carries the wrapper's header (type
  // caption + title), which is ~45px on its own. At h=2 the body collapsed to a
  // sliver and the bar was neither readable nor clickable — hence h=4, and the
  // bar has its own minimum height so a hand-resize cannot squash it again.
  defaultSize: { w: 16, h: 4 },
  minSize: { w: 6, h: 3 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

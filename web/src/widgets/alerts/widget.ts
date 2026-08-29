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

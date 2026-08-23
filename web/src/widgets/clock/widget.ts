import { IconClock } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const configSchema = z
  .object({
    ...baseWidgetConfig,
    /** IANA timezone; absent = system timezone. */
    timeZone: z.string().refine(isValidTimeZone, "Unknown timezone").optional(),
    format: z.enum(["24h", "12h"]).default("24h"),
  })
  .strict();

export type ClockConfig = z.infer<typeof configSchema>;

const descriptor: WidgetDescriptor<ClockConfig> = {
  type: "clock",
  Icon: IconClock,
  name: "Clock",
  description: "Digital clock — time and date",
  configSchema,
  defaultConfig: { format: "24h" },
  defaultSize: { w: 8, h: 6 },
  minSize: { w: 5, h: 4 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

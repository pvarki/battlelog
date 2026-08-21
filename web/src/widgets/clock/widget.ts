import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";

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
    /** IANA timezone; absent = system timezone. */
    timeZone: z.string().refine(isValidTimeZone, "Unknown timezone").optional(),
    format: z.enum(["24h", "12h"]).default("24h"),
  })
  .strict();

export type ClockConfig = z.infer<typeof configSchema>;

const descriptor: WidgetDescriptor<ClockConfig> = {
  type: "clock",
  name: "Clock",
  description: "Digital clock — time and date",
  configSchema,
  defaultConfig: { format: "24h" },
  defaultSize: { w: 5, h: 4 },
  minSize: { w: 3, h: 3 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

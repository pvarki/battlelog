import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";

const configSchema = z.object({}).strict();

const descriptor: WidgetDescriptor<z.infer<typeof configSchema>> = {
  type: "clock",
  name: "Clock",
  description: "Digital clock — time and date",
  configSchema,
  defaultConfig: {},
  defaultSize: { w: 5, h: 4 },
  minSize: { w: 3, h: 3 },
  View: lazy(() => import("./View.tsx")),
};

export default descriptor;

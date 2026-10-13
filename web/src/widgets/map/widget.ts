import { IconMap } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";
import { TAK_TOOLS } from "../../tak/tools.ts";

const configSchema = z
  .object({
    ...baseWidgetConfig,
    tools: z.array(z.enum(TAK_TOOLS)).default(["layers", "search"]),
    /** Where the map opens; absent = wherever this browser last left it. */
    view: z
      .object({
        center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
        zoom: z.number().min(0).max(24),
        bearing: z.number(),
      })
      .optional(),
  })
  .strict();

export type MapConfig = z.infer<typeof configSchema>;

const descriptor: WidgetDescriptor<MapConfig> = {
  type: "map",
  Icon: IconMap,
  name: "Map",
  description: "The TAK picture on a map, with the tools you choose",
  configSchema,
  defaultConfig: { tools: ["layers", "search"] },
  defaultSize: { w: 16, h: 12 },
  minSize: { w: 6, h: 5 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

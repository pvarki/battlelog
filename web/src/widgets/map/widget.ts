import { IconMap } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";
import { GROUP_LABEL } from "../../tak/overlays.ts";
import { TAK_TOOLS } from "../../tak/tools.ts";

const overlayGroups = z.array(
  z.string().refine((key) => Object.hasOwn(GROUP_LABEL, key), "Unknown overlay group"),
);

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
    /** "wall": no chrome or clicks, larger symbols, for a screen across the room. */
    display: z.enum(["normal", "wall"]).default("normal"),
    /** Items the map keeps in view as they move. */
    follow: z
      .object({
        callsigns: z.array(z.string()).optional(),
        mission: z.string().min(1).optional(),
        groups: overlayGroups.optional(),
      })
      .strict()
      .optional(),
    /** The overlay groups shown; absent = this browser's layer settings. */
    groups: overlayGroups.optional(),
    /** Missions shown on this map besides those this browser shows. */
    missions: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type MapConfig = z.infer<typeof configSchema>;

const descriptor: WidgetDescriptor<MapConfig> = {
  type: "map",
  Icon: IconMap,
  name: "Map",
  description: "The TAK picture on a map, with the tools you choose",
  configSchema,
  defaultConfig: { tools: ["layers", "search"], display: "normal", missions: [] },
  defaultSize: { w: 16, h: 12 },
  minSize: { w: 6, h: 5 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

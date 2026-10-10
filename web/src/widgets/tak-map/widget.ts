import { IconMap2 } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

export const LAYERS = ["contacts", "units", "markers", "drawings"] as const;
export type Layer = (typeof LAYERS)[number];

export const LAYER_LABEL: Record<Layer, string> = {
  contacts: "TAK users",
  units: "Units",
  markers: "Markers",
  drawings: "Drawings & routes",
};

export const BASEMAPS = {
  osm: {
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  },
  peruskartta: {
    label: "MML Peruskartta",
    url: "https://tiles.kartat.kapsi.fi/peruskartta/{z}/{x}/{y}.jpg",
    attribution: "© Maanmittauslaitos",
  },
  ortokuva: {
    label: "MML Ortokuva",
    url: "https://tiles.kartat.kapsi.fi/ortokuva/{z}/{x}/{y}.jpg",
    attribution: "© Maanmittauslaitos",
  },
} as const;
export type Basemap = keyof typeof BASEMAPS;

const configSchema = z
  .object({
    ...baseWidgetConfig,
    basemap: z.enum(Object.keys(BASEMAPS) as [Basemap, ...Basemap[]]).default("osm"),
    /** Layers switched off in this instance; absent = shown. */
    hiddenLayers: z.array(z.enum(LAYERS)).default([]),
    /** Missions (Data Sync feeds) switched off in this instance, by name; new missions show. */
    hiddenMissions: z.array(z.string()).default([]),
  })
  .strict();

export type TakMapConfig = z.infer<typeof configSchema>;

const descriptor: WidgetDescriptor<TakMapConfig> = {
  type: "tak-map",
  Icon: IconMap2,
  name: "TAK map",
  description: "Live TAK picture: users, units, markers, drawings and missions",
  configSchema,
  defaultConfig: { basemap: "osm", hiddenLayers: [], hiddenMissions: [] },
  defaultSize: { w: 16, h: 12 },
  minSize: { w: 6, h: 6 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

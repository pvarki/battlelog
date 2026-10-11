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
    /**
     * Missions (Data Sync feeds) by name. `except` shows every mission but the
     * listed ones, so new missions appear; `only` pins the widget to the listed ones.
     */
    missionFilter: z.enum(["except", "only"]).default("except"),
    missionNames: z.array(z.string()).default([]),
    /** Live TAK items; off turns the widget into a missions-only view. */
    showLive: z.boolean().default(true),
    /** Live items with a team (TAK users) are limited to these teams; empty = all. */
    teams: z.array(z.string()).default([]),
    /** Hide live items not updated within this many minutes; null = no limit. */
    maxAgeMinutes: z.number().int().positive().nullable().default(null),
    showStale: z.boolean().default(true),
    /** `fit-always` keeps the map on all items, for unattended wall displays. */
    view: z.enum(["fit-once", "fit-always", "saved"]).default("fit-once"),
    savedView: z
      .object({ lat: z.number(), lon: z.number(), zoom: z.number() })
      .nullable()
      .default(null),
    /** Live item (CoT uid) the map stays centred on; overrides `view` while it exists. */
    followId: z.string().nullable().default(null),
    labels: z.enum(["auto", "always", "never"]).default("auto"),
    panelOpen: z.boolean().default(true),
  })
  .strict();

export type TakMapConfig = z.infer<typeof configSchema>;

const descriptor: WidgetDescriptor<TakMapConfig> = {
  type: "tak-map",
  Icon: IconMap2,
  name: "TAK map",
  description: "Live TAK picture: users, units, markers, drawings and missions",
  configSchema,
  defaultConfig: configSchema.parse({}),
  defaultSize: { w: 16, h: 12 },
  minSize: { w: 6, h: 6 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

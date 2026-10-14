import { IconMap } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";
import { GROUP_LABEL } from "../../tak/overlays.ts";
import { CARD_ACTIONS, MAP_CONTROLS, type MapControl } from "../../tak/view-options.ts";

const overlayGroups = z.array(
  z.string().refine((key) => Object.hasOwn(GROUP_LABEL, key), "Unknown overlay group"),
);

const DEFAULT_CONTROLS: MapControl[] = ["search", "layers", "zoom", "status", "openInMap"];
const WALL_CONTROLS: MapControl[] = ["status"];
const WALL_SYMBOL_SCALE = 1.5;

/** Widgets saved as a mini workspace (`tools`) keep their search and layers as controls. */
const migrate = (input: unknown) => {
  if (typeof input !== "object" || input === null || !("tools" in input)) return input;
  const { tools, ...rest } = input as { tools?: unknown; controls?: unknown; display?: unknown };
  // A wall ignored its tools: it keeps the wall preset's controls.
  if (rest.controls !== undefined || rest.display === "wall" || !Array.isArray(tools)) return rest;
  const kept = DEFAULT_CONTROLS.filter(
    (c) => (c !== "search" && c !== "layers") || tools.includes(c),
  );
  return { ...rest, controls: kept };
};

// Absent fields mean "as this browser has it" or "as the display preset has it": see `effectiveMap`.
const configSchema = z.preprocess(
  migrate,
  z
    .object({
      ...baseWidgetConfig,
      /** A preset: "wall" is for a screen read from across the room. */
      display: z.enum(["normal", "wall"]).default("normal"),

      /** A built-in background map's id. */
      basemap: z.string().min(1).max(64).optional(),
      /** A built-in map drawn see-through over the background. */
      overlay: z
        .object({
          source: z.string().min(1).max(64),
          opacity: z.number().min(0.1).max(1).default(0.5),
        })
        .strict()
        .optional(),
      dim: z.boolean().optional(),
      mgrsGrid: z.boolean().optional(),
      /** Every moving item's recent track. */
      tracks: z.boolean().optional(),
      /** The overlay groups shown. */
      groups: overlayGroups.optional(),
      /** Missions shown besides those this browser shows. */
      missions: z.array(z.string().min(1)).default([]),
      /** The BattleLog layers shown, by layer event id. */
      eventLayers: z.array(z.string().uuid()).optional(),

      /** Where the map opens; absent = wherever this browser last left it. */
      view: z
        .object({
          center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
          zoom: z.number().min(0).max(24),
          bearing: z.number(),
        })
        .optional(),
      /** Items the map keeps in view as they move. */
      follow: z
        .object({
          callsigns: z.array(z.string()).optional(),
          mission: z.string().min(1).optional(),
          groups: overlayGroups.optional(),
        })
        .strict()
        .optional(),
      symbolScale: z.number().min(0.5).max(3).optional(),

      controls: z.array(z.enum(MAP_CONTROLS)).optional(),
      /** Dragging, scrolling and pinching move the map. */
      panZoom: z.boolean().optional(),
      /** Clicking an item selects it and shows its card. */
      select: z.boolean().optional(),
      cardActions: z.array(z.enum(CARD_ACTIONS)).optional(),
      /** Selections go out to the dashboard, so other widgets follow them. */
      shareSelection: z.boolean().optional(),
      /** A selection made in another widget brings it into view. */
      centreOnSelection: z.boolean().optional(),
      /** Answers a form's "Pick on map". */
      answerPicks: z.boolean().optional(),
    })
    .strict(),
);

export type MapConfig = z.infer<typeof configSchema>;

/** The config with every preset default filled in. */
export const effectiveMap = (config: MapConfig) => {
  const wall = config.display === "wall";
  return {
    controls: new Set(config.controls ?? (wall ? WALL_CONTROLS : DEFAULT_CONTROLS)),
    cardActions: new Set(config.cardActions ?? CARD_ACTIONS),
    symbolScale: config.symbolScale ?? (wall ? WALL_SYMBOL_SCALE : 1),
    panZoom: config.panZoom ?? !wall,
    select: config.select ?? !wall,
    shareSelection: config.shareSelection ?? true,
    centreOnSelection: config.centreOnSelection ?? true,
    answerPicks: config.answerPicks ?? !wall,
  };
};

const descriptor: WidgetDescriptor<MapConfig> = {
  type: "map",
  Icon: IconMap,
  name: "Map",
  description: "The TAK picture as a view you set up: what it shows, what viewers can do",
  configSchema,
  defaultConfig: { display: "normal", missions: [] },
  defaultSize: { w: 16, h: 12 },
  minSize: { w: 6, h: 5 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

import { IconActivity } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";
import { eventFilterShape } from "../../event-binding/filter.ts";

/** Built-in event fields a column can show, in canonical order. */
export const FIELDS = ["time", "header", "type", "tags", "admiralty", "createdBy"] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABEL: Record<Field, string> = {
  time: "Time",
  header: "Header",
  type: "Type",
  tags: "Tags",
  admiralty: "Adm.",
  createdBy: "By",
};

const SOURCES = [...FIELDS, "data"] as const;

export const DEFAULT_COLUMN_WIDTH = 140;
export const MIN_COLUMN_WIDTH = 72;
export const MAX_COLUMN_WIDTH = 640;

// Legacy configs stored columns as plain field names; lift them to objects.
const columnSchema = z.preprocess(
  (v) => (typeof v === "string" ? { id: v, source: v } : v),
  z
    .object({
      id: z.string().min(1).max(64),
      // Empty strings must validate: the config drawer persists every keystroke.
      label: z.string().max(40).default(""),
      source: z.enum(SOURCES).default("header"),
      /** Dot path into the event's `data` jsonb; used when source is "data". */
      dataPath: z.string().max(200).default(""),
      width: z.number().int().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH).optional(),
    })
    .strict(),
);

export type FeedColumn = z.infer<typeof columnSchema>;

const configSchema = z
  .object({
    ...baseWidgetConfig,
    ...eventFilterShape,
    /** While the map has a TAK item selected (`?tak=`), only events linked to it. */
    followTakSelection: z.boolean().optional(),
    rows: z.number().int().min(1).max(100).default(10),
    columns: z
      .array(columnSchema)
      .min(1)
      .max(20)
      .default(["time", "header", "type"] as unknown as FeedColumn[]),
  })
  .strict();

export type FeedConfig = z.infer<typeof configSchema>;

export const labelFor = (col: FeedColumn): string => {
  if (col.label) return col.label;
  if (col.source !== "data") return FIELD_LABEL[col.source];
  return col.dataPath.split(".").at(-1) || "Data";
};

const widthForLabel = (label: string): number =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, label.length * 8 + 32));

export const columnWidth = (col: FeedColumn): number => col.width ?? widthForLabel(labelFor(col));

const descriptor: WidgetDescriptor<FeedConfig> = {
  type: "feed",
  Icon: IconActivity,
  name: "Event feed",
  description: "Live event list with a configurable filter and columns",
  configSchema,
  defaultConfig: {
    rows: 10,
    columns: [
      { id: "time", label: "", source: "time", dataPath: "" },
      { id: "header", label: "", source: "header", dataPath: "" },
      { id: "type", label: "", source: "type", dataPath: "" },
    ],
  },
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 6, h: 3 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

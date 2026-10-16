import { IconTableColumn } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";
import { optionSchema } from "../../event-binding/options.ts";
import { eventQueryShape } from "../../event-binding/query.ts";

/** Event columns every event has; shown read-only except an opt-in editable header. */
export const BUILTIN_SOURCES = ["header", "type", "time", "tags", "createdBy"] as const;
export type BuiltinSource = (typeof BUILTIN_SOURCES)[number];

export const SOURCE_LABEL: Record<BuiltinSource | "data", string> = {
  data: "Data field",
  header: "Header",
  type: "Type",
  time: "Time",
  tags: "Tags",
  createdBy: "Created by",
};

/** Narrowing of a column's rows; which fields apply depends on the column kind. */
const columnFilterSchema = z.object({
  text: z.string().max(200).optional(),
  min: z.string().max(40).optional(),
  max: z.string().max(40).optional(),
  values: z.array(z.string().max(200)).max(20).optional(),
  bool: z.enum(["yes", "no"]).optional(),
});
export type ColumnFilter = z.infer<typeof columnFilterSchema>;

// Lenient strings throughout: the config drawer persists every keystroke.
const columnSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(60).default(""),
  source: z.enum(["data", ...BUILTIN_SOURCES]).default("data"),
  /** Dot path into the event's `data`; used when source is "data". */
  field: z.string().max(200).default(""),
  kind: z.enum(["text", "count", "choice", "boolean"]).default("text"),
  options: z.array(optionSchema).max(12).default([]),
  /** Data fields (and the header) only: cells write back to the event. */
  editable: z.boolean().default(false),
  /** Applied when the table opens; viewers may change it per session when filtering is allowed. */
  defaultFilter: columnFilterSchema.optional(),
});
export type TableColumn = z.infer<typeof columnSchema>;

const configSchema = z
  .object({
    ...baseWidgetConfig,
    ...eventQueryShape,
    columns: z.array(columnSchema).max(30).default([]),
    /** Default row order: "header", "created", or a column id. Clicking a column header overrides it per session. */
    sortBy: z.string().max(64).default("header"),
    sortDir: z.enum(["asc", "desc"]).default("asc"),
    rowLimit: z.number().int().min(1).max(500).default(100),
    /** Off: column headers don't sort; the default order always applies. */
    allowSorting: z.boolean().default(true),
    /** Off: no filter buttons; default filters still apply, as a fixed view. */
    allowFiltering: z.boolean().default(true),
    /** While the map has a TAK item selected (`?tak=`), only events linked to it. */
    followTakSelection: z.boolean().optional(),
  })
  .strict();

export type EventTableConfig = z.infer<typeof configSchema>;

export const columnLabel = (col: TableColumn): string =>
  col.label.trim() ||
  (col.source === "data" ? col.field.split(".").at(-1) || "Data" : SOURCE_LABEL[col.source]);

const descriptor: WidgetDescriptor<EventTableConfig> = {
  type: "eventtable",
  Icon: IconTableColumn,
  name: "Event table",
  description: "One row per matching event, with typed and editable columns",
  configSchema,
  defaultConfig: {
    types: "",
    tags: "",
    dataFilters: [],
    columns: [
      {
        id: "col-header",
        label: "",
        source: "header",
        field: "",
        kind: "text",
        options: [],
        editable: false,
      },
    ],
    sortBy: "header",
    sortDir: "asc",
    rowLimit: 100,
    allowSorting: true,
    allowFiltering: true,
  },
  defaultSize: { w: 16, h: 10 },
  minSize: { w: 8, h: 4 },
  showOnMobile: false,
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

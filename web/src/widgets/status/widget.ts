import { IconGauge } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor, WidgetDocumentDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

import { optionSchema } from "../../event-binding/options.ts";
import { eventQueryShape } from "../../event-binding/query.ts";

export {
  STATUS_COLORS,
  type StatusColor,
  type StatusOption,
} from "../../event-binding/options.ts";

/** A line under each event of a "sections" group: same value kinds as a row, bound to one field of the event. */
const propertySchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(60).default(""),
  field: z.string().max(100).default(""),
  kind: z.enum(["choice", "count", "text"]).default("choice"),
  options: z.array(optionSchema).max(12).default([]),
  editable: z.boolean().default(false),
});
export type StatusProperty = z.infer<typeof propertySchema>;

/** One child row per matching event (list: kind/options/editable of the row apply to every child). Lenient strings: config forms persist mid-edit. */
const groupSchema = z.object({
  ...eventQueryShape,
  field: z.string().max(100).default(""),
  /** "list": one row per event showing `field`. "sections": a header per event with `properties` under it. */
  layout: z.enum(["list", "sections"]).default("list"),
  /** Sections: data path for the event's header; its `header` when empty or missing. */
  labelField: z.string().max(100).default(""),
  properties: z.array(propertySchema).max(20).default([]),
});
export type StatusGroup = z.infer<typeof groupSchema>;

const statusRowSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(60),
  /** Shown as a tooltip on longer hover over the row. */
  description: z.string().max(300).optional(),
  /** "choice": one of the configured options (a boolean is a 2-option choice). "count": a number with −/+. "text": the raw value (editable on bound rows). */
  kind: z.enum(["choice", "count", "text"]).default("choice"),
  options: z.array(optionSchema).max(12).default([]),
  /** Reads the value from `data.<field>` (dot path) of another event instead of the board's own values. Lenient: config forms persist mid-edit. */
  source: z.object({ eventId: z.string().max(64), field: z.string().max(100) }).optional(),
  /** Dynamic rows: the label is a group header and the matching events are its rows. Exclusive with `source`. */
  group: groupSchema.optional(),
  /** Bound rows only: clicking writes the field back to the source event. */
  editable: z.boolean().default(false),
});
export type StatusRow = z.infer<typeof statusRowSchema>;

const configSchema = z
  .object({
    ...baseWidgetConfig,
    statuses: z.array(statusRowSchema).max(30).default([]),
    /** Current values live in the event log as a type:"status" event chain. */
    eventId: z.string().uuid().optional(),
  })
  .strict();

export type StatusConfig = z.infer<typeof configSchema>;

/** Current value per status row id: option value (choice) or number (count). */
export type StatusValues = { values: Record<string, string | number> };

export const parseValues = (data: unknown): StatusValues => {
  const values = (data as { values?: unknown } | null)?.values;
  return { values: values && typeof values === "object" ? (values as StatusValues["values"]) : {} };
};

export const widgetDocument: WidgetDocumentDescriptor<StatusConfig, StatusValues> = {
  eventType: "status",
  empty: { values: {} },
  parse: parseValues,
  headerFor: (config) => config.title?.trim() || "Status board",
  // Chip clicks are discrete actions — save promptly, coalescing bursts.
  debounceMs: 400,
};

export const descriptor: WidgetDescriptor<StatusConfig> = {
  type: "status",
  Icon: IconGauge,
  name: "Status board",
  description: "Unit/task statuses — colored state chips and counters",
  configSchema,
  defaultConfig: { statuses: [] },
  defaultSize: { w: 8, h: 8 },
  minSize: { w: 5, h: 3 },
  document: widgetDocument,
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

import { IconActivity } from "@tabler/icons-react";
import type { InferRequestType } from "hono/client";
import { lazy } from "react";
import { z } from "zod";
import type { api, EventResponse } from "../../api.ts";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";

type EventsQuery = InferRequestType<typeof api.events.$get>["query"];

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
    /** Shown bold in the widget header (rendered by the wrapper). */
    title: z.string().max(100).optional(),
    /** Per-instance mobile visibility; default shown. */
    showOnMobile: z.boolean().optional(),
    types: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    /** Header substring, case-insensitive. */
    search: z.string().optional(),
    createdBy: z.string().optional(),
    rows: z.number().int().min(1).max(100).default(10),
    columns: z
      .array(columnSchema)
      .min(1)
      .max(20)
      .default(["time", "header", "type"] as unknown as FeedColumn[]),
  })
  .strict();

export type FeedConfig = z.infer<typeof configSchema>;

/**
 * Ephemeral fullscreen filters. They only ever narrow: config filters stay
 * locked, extras AND on top. Dates are datetime-local strings.
 */
export type FeedExtras = {
  types?: string[];
  tags?: string[];
  search?: string;
  createdBy?: string;
  eventTimeFrom?: string;
  eventTimeTo?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
};

/** Scalar at a dot path in the event's `data` jsonb; "" when missing or non-scalar. */
export const dataValue = (data: unknown, path: string): string => {
  let v: unknown = data;
  for (const key of path.split(".")) {
    if (v === null || typeof v !== "object") return "";
    v = (v as Record<string, unknown>)[key];
  }
  return v == null || typeof v === "object" ? "" : String(v);
};

export const labelFor = (col: FeedColumn): string => {
  if (col.label) return col.label;
  if (col.source !== "data") return FIELD_LABEL[col.source];
  return col.dataPath.split(".").at(-1) || "Data";
};

const widthForLabel = (label: string): number =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, label.length * 8 + 32));

export const columnWidth = (col: FeedColumn): number => col.width ?? widthForLabel(labelFor(col));

/**
 * Server-side query for the initial batch (limit is added by the hook).
 * Config filters win where both could apply — extras only narrow, so the
 * server result is a superset and {@link matchesFeed} does the exact cut.
 * Time ranges exist only in extras and pass straight through.
 */
// Cast like the explorer's buildQuery: dates travel as datetime-local strings.
export const queryFor = (config: FeedConfig, extras?: FeedExtras): EventsQuery =>
  ({
    ...(config.types?.length ? { types: config.types.join(",") } : {}),
    ...(config.tags?.length ? { tags: config.tags.join(",") } : {}),
    ...(config.search || extras?.search ? { search: config.search || extras?.search } : {}),
    ...(config.createdBy || extras?.createdBy
      ? { createdBy: config.createdBy || extras?.createdBy }
      : {}),
    ...(extras?.eventTimeFrom ? { eventTimeFrom: extras.eventTimeFrom } : {}),
    ...(extras?.eventTimeTo ? { eventTimeTo: extras.eventTimeTo } : {}),
    ...(extras?.createdAtFrom ? { createdAtFrom: extras.createdAtFrom } : {}),
    ...(extras?.createdAtTo ? { createdAtTo: extras.createdAtTo } : {}),
  }) as EventsQuery;

const inRange = (value: string | null, from?: string, to?: string): boolean => {
  if (!from && !to) return true;
  if (value === null) return false;
  const t = Date.parse(value);
  if (from && t < Date.parse(from)) return false;
  if (to && t > Date.parse(to)) return false;
  return true;
};

/** Client-side mirror of the full filter for rows from the shared stream. */
export const matchesFeed = (
  row: EventResponse,
  config: FeedConfig,
  extras?: FeedExtras,
): boolean => {
  if (config.types?.length && (row.type === null || !config.types.includes(row.type))) return false;
  if (config.tags?.length && !config.tags.some((t) => row.tags?.includes(t))) return false;
  if (config.search && !row.header.toLowerCase().includes(config.search.toLowerCase()))
    return false;
  if (config.createdBy && row.createdBy !== config.createdBy) return false;
  if (!extras) return true;
  if (extras.types?.length && (row.type === null || !extras.types.includes(row.type))) return false;
  if (extras.tags?.length && !extras.tags.some((t) => row.tags?.includes(t))) return false;
  if (extras.search && !row.header.toLowerCase().includes(extras.search.toLowerCase()))
    return false;
  if (extras.createdBy && row.createdBy !== extras.createdBy) return false;
  if (!inRange(row.eventTime, extras.eventTimeFrom, extras.eventTimeTo)) return false;
  if (!inRange(row.createdAt, extras.createdAtFrom, extras.createdAtTo)) return false;
  return true;
};

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

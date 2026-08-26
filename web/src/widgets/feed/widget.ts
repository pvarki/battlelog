import { IconActivity } from "@tabler/icons-react";
import type { InferRequestType } from "hono/client";
import { lazy } from "react";
import { z } from "zod";
import type { api, EventResponse } from "../../api.ts";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

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

/**
 * A saved narrowing of the feed, with the columns that suit it.
 *
 * This is what makes one feed several logs: a view names the condition that
 * defines a log — a data field holding a value, or any of the ordinary filters —
 * and carries the columns worth showing for it. Tapping the widget's view name
 * moves to the next one.
 *
 * Views are written by hand, never discovered: a feed should show the states
 * someone chose, not every field the rows happen to carry.
 */
const viewSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(40),
    /** Data field that must hold {@link dataValue}. Empty = no data condition. */
    dataKey: z.string().max(200).default(""),
    /** Compared with its JSON type: "true" is the boolean, "2" the number. */
    dataValue: z.string().max(200).default(""),
    /** Override the widget's own filters, for the fields the view sets. */
    types: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    ingestSources: z.array(z.string().uuid()).optional(),
    columns: z.array(columnSchema).min(1).max(20),
  })
  .strict();

export type FeedView = z.infer<typeof viewSchema>;

const configSchema = z
  .object({
    ...baseWidgetConfig,
    /** Empty or absent = one unnamed view, which is how the widget behaved before. */
    views: z.array(viewSchema).max(12).optional(),
    /** Which view is showing. Persisted, so a board looks the same to everyone. */
    activeViewId: z.string().max(64).optional(),
    types: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    /** Ingest setups to show, by id. Empty/absent = every source, ingested or not. */
    ingestSources: z.array(z.string().uuid()).optional(),
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

/** The view showing now: the selected one, else the first, else none. */
export const activeView = (config: FeedConfig): FeedView | undefined =>
  config.views?.find((v) => v.id === config.activeViewId) ?? config.views?.[0];

/** The next view to show, wrapping. */
export const nextViewId = (config: FeedConfig): string | undefined => {
  const views = config.views ?? [];
  if (views.length < 2) return config.activeViewId;
  const at = views.findIndex((v) => v.id === activeView(config)?.id);
  return views[(at + 1) % views.length]?.id;
};

/**
 * The widget's filters with the active view's applied on top.
 *
 * The view wins for any field it sets, so a view is the whole definition of the
 * log it names rather than something layered onto a filter the operator cannot
 * see. Fields it leaves alone keep the widget's own value.
 */
export const effectiveConfig = (config: FeedConfig): FeedConfig => {
  const view = activeView(config);
  if (!view) return config;
  return {
    ...config,
    types: view.types ?? config.types,
    tags: view.tags ?? config.tags,
    ingestSources: view.ingestSources ?? config.ingestSources,
    columns: view.columns,
  };
};

/** Columns to render: the active view's, else the widget's own. */
export const effectiveColumns = (config: FeedConfig): FeedColumn[] =>
  activeView(config)?.columns ?? config.columns;

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
export const queryFor = (config: FeedConfig, extras?: FeedExtras): EventsQuery => {
  const view = activeView(config);
  return {
    ...(config.types?.length ? { types: config.types.join(",") } : {}),
    ...(config.tags?.length ? { tags: config.tags.join(",") } : {}),
    ...(config.ingestSources?.length ? { ingestSources: config.ingestSources.join(",") } : {}),
    ...(view?.dataKey ? { dataKey: view.dataKey, dataValue: view.dataValue } : {}),
    ...(config.search || extras?.search ? { search: config.search || extras?.search } : {}),
    ...(config.createdBy || extras?.createdBy
      ? { createdBy: config.createdBy || extras?.createdBy }
      : {}),
    ...(extras?.eventTimeFrom ? { eventTimeFrom: extras.eventTimeFrom } : {}),
    ...(extras?.eventTimeTo ? { eventTimeTo: extras.eventTimeTo } : {}),
    ...(extras?.createdAtFrom ? { createdAtFrom: extras.createdAtFrom } : {}),
    ...(extras?.createdAtTo ? { createdAtTo: extras.createdAtTo } : {}),
  } as EventsQuery;
};

const inRange = (value: string | null, from?: string, to?: string): boolean => {
  if (!from && !to) return true;
  if (value === null) return false;
  const t = Date.parse(value);
  if (from && t < Date.parse(from)) return false;
  if (to && t > Date.parse(to)) return false;
  return true;
};

/** Client-side mirror of the full filter for rows from the shared stream. */
/** Same coercion the server applies, so a view means one thing in both places. */
const parseDataValue = (raw: string): string | number | boolean => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return raw;
};

export const matchesFeed = (
  row: EventResponse,
  config: FeedConfig,
  extras?: FeedExtras,
): boolean => {
  const active = effectiveConfig(config);
  if (active.types?.length && (row.type === null || !active.types.includes(row.type))) return false;
  if (active.tags?.length && !active.tags.some((t) => row.tags?.includes(t))) return false;
  if (
    active.ingestSources?.length &&
    (!row.ingestSourceId || !active.ingestSources.includes(row.ingestSourceId))
  ) {
    return false;
  }
  const view = activeView(config);
  if (view?.dataKey) {
    const data = row.data as Record<string, unknown> | null;
    if (!data || data[view.dataKey] !== parseDataValue(view.dataValue)) return false;
  }
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

/**
 * The filters this widget is currently narrowing by, in words.
 *
 * An empty feed is otherwise indistinguishable from a quiet one, and the
 * difference matters: a filter naming something nothing produces will never fill
 * up, however long you wait or whatever else you change. Filters AND together,
 * so listing them all is what makes an impossible combination obvious.
 */
export const activeFilters = (config: FeedConfig): string[] => {
  const parts: string[] = [];
  if (config.types?.length) parts.push(`type: ${config.types.join(", ")}`);
  if (config.tags?.length) parts.push(`tag: ${config.tags.join(", ")}`);
  if (config.ingestSources?.length) {
    parts.push(
      config.ingestSources.length === 1
        ? "one ingest setup"
        : `${config.ingestSources.length} ingest setups`,
    );
  }
  if (config.search) parts.push(`text: ${config.search}`);
  if (config.createdBy) parts.push(`by: ${config.createdBy}`);
  return parts;
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

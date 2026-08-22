import { lazy } from "react";
import { z } from "zod";
import type { EventResponse } from "../../api.ts";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";

/** Canonical column order — the config picks which, never where. */
export const COLUMNS = ["time", "header", "type", "tags", "admiralty", "createdBy"] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABEL: Record<Column, string> = {
  time: "Time",
  header: "Header",
  type: "Type",
  tags: "Tags",
  admiralty: "Adm.",
  createdBy: "By",
};

const configSchema = z
  .object({
    /** Shown bold in the widget header (rendered by the wrapper). */
    title: z.string().max(100).optional(),
    types: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    /** Header substring, case-insensitive. */
    search: z.string().optional(),
    createdBy: z.string().optional(),
    rows: z.number().int().min(1).max(100).default(10),
    columns: z.array(z.enum(COLUMNS)).min(1).default(["time", "header", "type"]),
  })
  .strict();

export type FeedConfig = z.infer<typeof configSchema>;

/** Server-side query for the initial batch (limit is added by the hook). */
export const queryFor = (config: FeedConfig) => ({
  ...(config.types?.length ? { types: config.types.join(",") } : {}),
  ...(config.tags?.length ? { tags: config.tags.join(",") } : {}),
  ...(config.search ? { search: config.search } : {}),
  ...(config.createdBy ? { createdBy: config.createdBy } : {}),
});

/** Client-side mirror of {@link queryFor} for rows from the shared stream. */
export const matchesFeed = (row: EventResponse, config: FeedConfig): boolean => {
  if (config.types?.length && (row.type === null || !config.types.includes(row.type))) return false;
  if (config.tags?.length && !config.tags.some((t) => row.tags?.includes(t))) return false;
  if (config.search && !row.header.toLowerCase().includes(config.search.toLowerCase()))
    return false;
  if (config.createdBy && row.createdBy !== config.createdBy) return false;
  return true;
};

const descriptor: WidgetDescriptor<FeedConfig> = {
  type: "feed",
  name: "Event feed",
  description: "Live event list with a configurable filter and columns",
  configSchema,
  defaultConfig: { rows: 10, columns: ["time", "header", "type"] },
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 6, h: 3 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";

const columnSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(40),
  /** "formula" columns compute over the row's number columns; not stored. */
  kind: z.enum(["text", "number", "formula"]).default("text"),
  formula: z.string().max(200).optional(),
});
export type TableColumn = z.infer<typeof columnSchema>;

const configSchema = z
  .object({
    /** Shown bold in the widget header (rendered by the wrapper). */
    title: z.string().max(100).optional(),
    columns: z.array(columnSchema).max(20).default([]),
    /** Row values live in the event log as a type:"table" event chain. */
    eventId: z.string().uuid().optional(),
  })
  .strict();

export type TableConfig = z.infer<typeof configSchema>;

/** One row: cell text per column id. Formula cells are computed, never stored. */
export type TableDoc = { rows: Record<string, string>[] };

const rowSchema = z.record(z.string());

/** Tolerant read: entries a raw API write could sneak in (null, arrays,
 * non-string cells) are dropped instead of crashing the render. */
export const parseRows = (data: unknown): TableDoc => {
  const rows = (data as { rows?: unknown } | null)?.rows;
  return {
    rows: Array.isArray(rows)
      ? rows.filter((r): r is Record<string, string> => rowSchema.safeParse(r).success)
      : [],
  };
};

const descriptor: WidgetDescriptor<TableConfig> = {
  type: "table",
  name: "Table",
  description: "Manually updated table with optional formula columns",
  configSchema,
  defaultConfig: { columns: [] },
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 6, h: 4 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

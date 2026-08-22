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

export const DEFAULT_COLUMN_COUNT = 3;
export const DEFAULT_ROW_COUNT = 10;

const columnLabel = (index: number): string => {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode("A".charCodeAt(0) + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
};

export const tableColumns = (count = DEFAULT_COLUMN_COUNT): TableColumn[] =>
  Array.from({ length: count }, (_, index) => {
    const label = columnLabel(index);
    return {
      id: label,
      label,
      kind: "text",
      formula: undefined,
    };
  });

export const PRESET_TABLE_COLUMNS: TableColumn[] = tableColumns(DEFAULT_COLUMN_COUNT);

export const tableColumnCount = (count: number | undefined): number => {
  const parsed = Math.trunc(count ?? DEFAULT_COLUMN_COUNT);
  return Math.min(26, Math.max(1, parsed));
};

export const tableRowCount = (count: number | undefined): number => {
  const parsed = Math.trunc(count ?? DEFAULT_ROW_COUNT);
  return Math.min(500, Math.max(1, parsed));
};

const configSchema = z
  .object({
    /** Shown bold in the widget header (rendered by the wrapper). */
    title: z.string().max(100).optional(),
    columns: z.array(columnSchema).max(26).default([]),
    columnCount: z.number().int().min(1).max(26).default(DEFAULT_COLUMN_COUNT),
    rowCount: z.number().int().min(1).max(500).default(DEFAULT_ROW_COUNT),
    hideRowNumbers: z.boolean().default(false),
    hideColumnHeaders: z.boolean().default(false),
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
  description: "Spreadsheet-style table with preset columns",
  configSchema,
  defaultConfig: {
    columnCount: DEFAULT_COLUMN_COUNT,
    columns: PRESET_TABLE_COLUMNS,
    hideColumnHeaders: false,
    hideRowNumbers: false,
    rowCount: DEFAULT_ROW_COUNT,
  },
  defaultSize: { w: 18, h: 10 },
  minSize: { w: 6, h: 4 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;

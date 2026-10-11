import type { EventResponse } from "../../api.ts";
import type { BoundState } from "../../event-binding/paths.ts";
import type { BuiltinSource, ColumnFilter, TableColumn } from "./widget.ts";

export type SortDir = "asc" | "desc";

export const builtinValue = (event: EventResponse, source: BuiltinSource): string | null => {
  switch (source) {
    case "header":
      return event.header;
    case "type":
      return event.type;
    case "time":
      return event.eventTime ?? event.createdAt;
    case "tags":
      return event.tags?.length ? event.tags.join(", ") : null;
    case "createdBy":
      return event.createdBy;
  }
};

const present = (cell: BoundState) => cell.state === "ok" && cell.value !== null;

/** Ascending order; empty and missing cells sort last in both directions. */
export const compareCells = (a: BoundState, b: BoundState, dir: SortDir): number => {
  if (!present(a) || !present(b)) return Number(!present(a)) - Number(!present(b));
  const av = (a as { value: unknown }).value;
  const bv = (b as { value: unknown }).value;
  const order =
    typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true });
  return dir === "asc" ? order : -order;
};

export const isFilterActive = (f: ColumnFilter | undefined): boolean =>
  !!f && !!(f.text?.trim() || f.min?.trim() || f.max?.trim() || f.values?.length || f.bool);

/** `display` is the text the cell shows, so a "contains" filter matches what the user sees. */
export const matchesFilter = (
  cell: BoundState,
  kind: TableColumn["kind"],
  filter: ColumnFilter | undefined,
  display: string,
): boolean => {
  if (!filter || !isFilterActive(filter)) return true;
  if (cell.state !== "ok") return false;
  const value = cell.value;
  if (kind === "boolean" && filter.bool) return (value === true) === (filter.bool === "yes");
  if (kind === "choice" && filter.values?.length) return filter.values.includes(String(value));
  if (kind === "count" && (filter.min?.trim() || filter.max?.trim())) {
    const n = Number(value);
    if (value === null || !Number.isFinite(n)) return false;
    if (filter.min?.trim() && n < Number(filter.min)) return false;
    if (filter.max?.trim() && n > Number(filter.max)) return false;
    return true;
  }
  if (filter.text?.trim()) return display.toLowerCase().includes(filter.text.trim().toLowerCase());
  return true;
};

/** The filters a table opens with: each column's configured default, active ones only. */
export const defaultFilters = (columns: TableColumn[]): Record<string, ColumnFilter> =>
  Object.fromEntries(
    columns.flatMap((c) =>
      isFilterActive(c.defaultFilter) ? [[c.id, c.defaultFilter ?? {}]] : [],
    ),
  );

// mathjs stays out of widget.ts: the registry imports descriptors eagerly,
// while this file is only reached through the lazy View/Config chunks.
import { evaluate } from "mathjs/number";
import type { TableColumn } from "./widget.ts";

/**
 * Formula identifier for a column label: "Unit price" → "unit_price".
 * Underscore-prefixed when digit-leading ("2024 Qty" → "_2024_qty") — mathjs
 * tokenizes a bare leading digit as a number, not a symbol.
 */
export const columnKey = (label: string): string => {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/\W+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^\d/.test(key) ? `_${key}` : key || "_";
};

/**
 * Key per number-column id, deduped in column order — "Qty (kg)" and
 * "Qty [kg]" normalize identically, so the second becomes "qty_kg_2" instead
 * of silently shadowing the first in the formula scope.
 */
export const columnKeys = (columns: TableColumn[]): Map<string, string> => {
  const used = new Set<string>();
  const keys = new Map<string, string>();
  for (const c of columns) {
    if (c.kind !== "number") continue;
    const base = columnKey(c.label);
    let key = base;
    for (let i = 2; used.has(key); i++) key = `${base}_${i}`;
    used.add(key);
    keys.set(c.id, key);
  }
  return keys;
};

const scopeFor = (row: Record<string, string>, columns: TableColumn[]) =>
  Object.fromEntries([...columnKeys(columns)].map(([id, key]) => [key, Number(row[id] || 0)]));

/** Formula result for one row, or "#ERR" (bad formula, non-numeric cell, ÷0). */
export const evaluateFormula = (
  formula: string,
  row: Record<string, string>,
  columns: TableColumn[],
): string => {
  try {
    const result: unknown = evaluate(formula, scopeFor(row, columns));
    return typeof result === "number" && Number.isFinite(result)
      ? String(Number(result.toFixed(6)))
      : "#ERR";
  } catch {
    return "#ERR";
  }
};

/** Config-time check: evaluates against an all-zero row so syntax errors and
 * unknown column references surface while typing. Null when the formula is ok. */
export const formulaError = (formula: string, columns: TableColumn[]): string | null => {
  try {
    evaluate(formula, scopeFor({}, columns));
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid formula";
  }
};

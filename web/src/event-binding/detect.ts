import type { ValueSpec } from "./options.ts";

export type FieldSuggestion = {
  path: string;
  kind: ValueSpec["kind"];
  /** Distinct values when few enough to be an enum's options. */
  options: string[];
  /** A value seen at this path, to recognise the field by. */
  sample: string;
};

const MAX_ENUM_VALUES = 6;
const MAX_DEPTH = 4;

/**
 * Every scalar dot path in the given `data` objects, with a guessed kind:
 * all numbers → count, all booleans → boolean, few distinct strings that
 * repeat → choice, anything else (mixed, many or unique strings, only nulls) → text.
 */
export const detectFields = (datas: unknown[]): FieldSuggestion[] => {
  const seen = new Map<string, unknown[]>();
  const walk = (value: unknown, path: string, depth: number) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (depth >= MAX_DEPTH) return;
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key, depth + 1);
      }
      return;
    }
    if (!path || Array.isArray(value)) return;
    seen.set(path, [...(seen.get(path) ?? []), value]);
  };
  for (const data of datas) walk(data, "", 0);

  return [...seen.entries()]
    .map(([path, values]) => {
      const present = values.filter((v) => v !== null && v !== undefined);
      const distinct = [...new Set(present.map(String))];
      const kind: ValueSpec["kind"] =
        present.length && present.every((v) => typeof v === "number")
          ? "count"
          : present.length && present.every((v) => typeof v === "boolean")
            ? "boolean"
            : present.length &&
                present.every((v) => typeof v === "string") &&
                distinct.length <= MAX_ENUM_VALUES &&
                distinct.length < present.length
              ? "choice"
              : "text";
      return {
        path,
        kind,
        options: kind === "choice" ? [...distinct].sort() : [],
        sample: distinct[0] ?? "",
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
};

/**
 * Parser for the previous selective-reference payload format.
 *
 * Earlier table documents used a custom formula that named an event and an
 * expression, for example:
 *
 *   =!01a1282b-36b7-74f2-83fc-cedfbc75465b:SUM(A1:A2)
 *
 * `workbook.ts` migrates it on load into an ordinary Univer formula pointing
 * at a runtime-only hidden source sheet. This module intentionally has no
 * Univer imports so old documents can be parsed before the editor is loaded.
 */

type JsonRecord = Record<string, unknown>;

export type ExternalFormulaMap = Record<string, string>;

export type ParsedExternalFormula = {
  eventId: string;
  expression: string;
};

// Event ids may use UUIDv7, so do not restrict the version nibble to v1-v5.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const externalFormulaPattern = new RegExp(`^=!\\s*(${UUID})\\s*:\\s*(.+?)\\s*$`, "i");
const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stable document key for a zero-based row and column. */
export const externalCellKey = (row: number, column: number): string => `${row}:${column}`;

export const parseExternalCellKey = (key: string): { row: number; column: number } | null => {
  const match = /^(\d+):(\d+)$/.exec(key);
  if (!match) return null;
  const row = Number(match[1]);
  const column = Number(match[2]);
  return Number.isSafeInteger(row) && Number.isSafeInteger(column) ? { row, column } : null;
};

/** Parses the user-facing `=!event-id:expression` syntax. */
export const parseExternalFormula = (value: unknown): ParsedExternalFormula | null => {
  if (typeof value !== "string") return null;
  const match = externalFormulaPattern.exec(value.trim());
  if (!match) return null;
  const eventId = match[1];
  const expression = match[2];
  if (!eventId || !expression) return null;
  return { eventId: eventId.toLowerCase(), expression: expression.trim() };
};

export const normalizeExternalFormulas = (value: unknown): ExternalFormulaMap => {
  if (!isRecord(value)) return {};
  const formulas: ExternalFormulaMap = {};
  for (const [key, formula] of Object.entries(value)) {
    if (typeof formula === "string" && parseExternalCellKey(key) && parseExternalFormula(formula)) {
      formulas[key] = formula;
    }
  }
  return formulas;
};

export const externalFormulaSourceIds = (formulas: ExternalFormulaMap): string[] =>
  [
    ...new Set(
      Object.values(formulas).flatMap((formula) => {
        const parsed = parseExternalFormula(formula);
        return parsed ? [parsed.eventId] : [];
      }),
    ),
  ].sort();

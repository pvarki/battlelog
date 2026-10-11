/**
 * Persistence boundary for the table widget.
 *
 * Univer's workbook snapshots contain quite a bit of presentation state. The
 * event log should keep cell data and intentional formatting, but not a sparse
 * table's empty rows, scroll position, extra sheets, or optional rich objects
 * such as drawings. This file deliberately has no Univer imports: it keeps the
 * document parser cheap for the eagerly-loaded widget registry and makes the
 * persistence contract easy to test.
 */

import {
  type ExternalFormulaMap,
  externalFormulaSourceIds,
  normalizeExternalFormulas,
  parseExternalCellKey,
  parseExternalFormula,
} from "./external-reference.ts";

export const TABLE_DOCUMENT_VERSION = "battlelog-univer/v1";
export const TABLE_SHEET_ID = "main";
export const TABLE_WORKBOOK_ID = "battlelog-table";
const TABLE_DEFAULT_TEXT_COLOR = "#f6f7f9";

type JsonRecord = Record<string, unknown>;

export type LegacyTableDoc = { rows: Record<string, string>[] };

export type UniverTableDoc = {
  version: typeof TABLE_DOCUMENT_VERSION;
  snapshot: JsonRecord;
  /**
   * Source event ids loaded as hidden Univer sheets at runtime. The visible
   * sheet uses normal native formulas to refer to those sheets.
   */
  externalSources?: string[];
  /** Legacy `=!event-id:...` formulas, migrated to native formulas on load. */
  externalFormulas?: ExternalFormulaMap;
};

/** A table can still read the compact row document written by older releases. */
export type TableDoc = LegacyTableDoc | UniverTableDoc;

export type TableSnapshotOptions = {
  title?: string;
  rowCount: number;
  columnCount: number;
  hideRowNumbers: boolean;
  hideColumnHeaders: boolean;
  columns: { id: string }[];
};

/** Loaded source documents, keyed by their event id. */
export type ExternalTableSources = Record<string, TableDoc | null | undefined>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const indexedEntries = (value: unknown): [string, JsonRecord][] =>
  isRecord(value)
    ? Object.entries(value).filter(
        (entry): entry is [string, JsonRecord] => /^\d+$/.test(entry[0]) && isRecord(entry[1]),
      )
    : [];

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * A cell with an empty value has no semantic content. Formula, style, rich
 * text, validation metadata, and other non-null fields do have meaning and
 * must survive a snapshot round trip.
 */
const cellHasData = (cell: JsonRecord): boolean =>
  Object.entries(cell).some(([key, value]) => {
    if (key === "v") return value !== "" && value !== null && value !== undefined;
    if (key === "f") return nonEmptyString(value);
    if (key === "t") return false;
    return value !== null && value !== undefined;
  });

const compactCellData = (value: unknown): JsonRecord => {
  const rows: JsonRecord = {};
  for (const [rowIndex, cells] of indexedEntries(value)) {
    const compactedCells: JsonRecord = {};
    for (const [columnIndex, cell] of indexedEntries(cells)) {
      if (cellHasData(cell)) compactedCells[columnIndex] = clone(cell);
    }
    if (Object.keys(compactedCells).length) rows[rowIndex] = compactedCells;
  }
  return rows;
};

const compactIndexedData = (value: unknown): JsonRecord => {
  const data: JsonRecord = {};
  for (const [index, entry] of indexedEntries(value)) {
    if (Object.keys(entry).length) data[index] = clone(entry);
  }
  return data;
};

const nonEmptyArray = (value: unknown): unknown[] | undefined =>
  Array.isArray(value) && value.length ? clone(value) : undefined;

const pickRecord = (source: JsonRecord, keys: string[]): JsonRecord => {
  const picked: JsonRecord = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) picked[key] = clone(value);
  }
  return picked;
};

const validStyles = (value: unknown): JsonRecord => (isRecord(value) ? clone(value) : {});

const firstSheetId = (snapshot: JsonRecord): string => {
  const sheetOrder = snapshot.sheetOrder;
  if (Array.isArray(sheetOrder) && typeof sheetOrder[0] === "string" && sheetOrder[0]) {
    return sheetOrder[0];
  }
  if (isRecord(snapshot.sheets)) {
    const [first] = Object.keys(snapshot.sheets);
    if (first) return first;
  }
  return TABLE_SHEET_ID;
};

/**
 * Strip snapshot state that a BattleLog table intentionally does not support.
 * In particular, this makes a one-sheet invariant durable rather than merely
 * hiding Univer's sheet tabs in the UI.
 */
export const compactWorkbookSnapshot = (value: unknown): JsonRecord => {
  const source = isRecord(value) ? value : {};
  const sheetId = firstSheetId(source);
  const sheets = isRecord(source.sheets) ? source.sheets : {};
  const rawSheet = isRecord(sheets[sheetId]) ? sheets[sheetId] : {};

  const sheet = pickRecord(rawSheet, [
    "id",
    "name",
    "defaultStyle",
    "defaultColumnWidth",
    "defaultRowHeight",
    "freeze",
    "showGridlines",
    "gridlinesColor",
    "rightToLeft",
  ]);
  sheet.id = sheetId;
  sheet.cellData = compactCellData(rawSheet.cellData);

  const rowData = compactIndexedData(rawSheet.rowData);
  if (Object.keys(rowData).length) sheet.rowData = rowData;
  const columnData = compactIndexedData(rawSheet.columnData);
  if (Object.keys(columnData).length) sheet.columnData = columnData;
  const mergeData = nonEmptyArray(rawSheet.mergeData);
  if (mergeData) sheet.mergeData = mergeData;

  const workbook = pickRecord(source, [
    "id",
    "name",
    "appVersion",
    "locale",
    "dateSystem",
    "defaultStyle",
  ]);
  workbook.id = typeof workbook.id === "string" && workbook.id ? workbook.id : TABLE_WORKBOOK_ID;
  workbook.name = typeof workbook.name === "string" && workbook.name ? workbook.name : "Table";
  workbook.appVersion =
    typeof workbook.appVersion === "string" && workbook.appVersion ? workbook.appVersion : "1.0.4";
  workbook.locale =
    typeof workbook.locale === "string" && workbook.locale ? workbook.locale : "en-US";
  workbook.styles = validStyles(source.styles);
  workbook.sheetOrder = [sheetId];
  workbook.sheets = { [sheetId]: sheet };
  return workbook;
};

const parseLegacyRows = (data: unknown): LegacyTableDoc => {
  const rows = isRecord(data) ? data.rows : undefined;
  return {
    rows: Array.isArray(rows)
      ? rows.filter(
          (row): row is Record<string, string> =>
            isRecord(row) && Object.values(row).every((cell) => typeof cell === "string"),
        )
      : [],
  };
};

export const isUniverTableDoc = (value: TableDoc): value is UniverTableDoc =>
  "version" in value && value.version === TABLE_DOCUMENT_VERSION;

/** Normalized external-reference metadata, empty for legacy documents. */
export const externalFormulasForDocument = (document: TableDoc): ExternalFormulaMap =>
  isUniverTableDoc(document) ? normalizeExternalFormulas(document.externalFormulas) : {};

/** Sources for native cross-sheet formulas, including documents awaiting migration. */
export const externalSourceIdsForDocument = (document: TableDoc): string[] => {
  if (!isUniverTableDoc(document)) return [];
  const explicit = Array.isArray(document.externalSources)
    ? document.externalSources.filter(nonEmptyString)
    : [];
  return [
    ...new Set([
      ...explicit.map((value) => value.toLowerCase()),
      ...externalFormulaSourceIds(externalFormulasForDocument(document)),
    ]),
  ].sort();
};

// Sheet names must stay short enough for Excel-compatible spreadsheet engines.
// Twenty-four UUID hex characters make collisions impractical while preserving
// Univer's 31-character Excel-compatible sheet-name limit.
export const externalSourceSheetName = (eventId: string): string =>
  `source_${eventId.replaceAll("-", "").slice(0, 24)}`;

const nativeFormulaForExternalFormula = (formula: string): string | null => {
  const parsed = parseExternalFormula(formula);
  if (!parsed) return null;
  const sourceSheet = externalSourceSheetName(parsed.eventId);
  // Prefix each A1 reference or range with the hidden source sheet. The
  // original expression supports simple scalar references and aggregates.
  const expression = parsed.expression.replace(
    /\$?[A-Z]+\$?[1-9]\d*(?::\$?[A-Z]+\$?[1-9]\d*)?/gi,
    (reference) => `${sourceSheet}!${reference}`,
  );
  return `=${expression}`;
};

/** Read current snapshots defensively, otherwise preserve the old table payload. */
export const parseTableDocument = (data: unknown): TableDoc => {
  if (isRecord(data) && data.version === TABLE_DOCUMENT_VERSION && isRecord(data.snapshot)) {
    const externalFormulas = normalizeExternalFormulas(data.externalFormulas);
    const externalSources = Array.isArray(data.externalSources)
      ? data.externalSources.filter(nonEmptyString).map((value) => value.toLowerCase())
      : [];
    return {
      version: TABLE_DOCUMENT_VERSION,
      snapshot: compactWorkbookSnapshot(data.snapshot),
      ...(externalSources.length ? { externalSources: [...new Set(externalSources)].sort() } : {}),
      ...(Object.keys(externalFormulas).length ? { externalFormulas } : {}),
    };
  }
  return parseLegacyRows(data);
};

export const emptyTableDocument = (): UniverTableDoc => ({
  version: TABLE_DOCUMENT_VERSION,
  snapshot: compactWorkbookSnapshot({}),
});

const cellAt = (cellData: JsonRecord, row: number, column: number): JsonRecord | undefined => {
  const cells = cellData[String(row)];
  const cell = isRecord(cells) ? cells[String(column)] : undefined;
  return isRecord(cell) ? cell : undefined;
};

const setCell = (cellData: JsonRecord, row: number, column: number, cell: JsonRecord): void => {
  const rowKey = String(row);
  const cells = isRecord(cellData[rowKey]) ? cellData[rowKey] : {};
  cells[String(column)] = cell;
  cellData[rowKey] = cells;
};

/**
 * Formula editors create a short-lived document from the cell's own style.
 * The sheet default already makes the canvas white, but an unstyled formula
 * can otherwise reopen with Univer's office-black editor default. Only fill
 * in a missing colour so deliberate cell formatting always wins.
 */
const withDefaultTextColor = (cell: JsonRecord): JsonRecord => {
  const styled = clone(cell);
  if (isRecord(styled.s)) {
    if ("cl" in styled.s) return styled;
    styled.s = { ...styled.s, cl: { rgb: TABLE_DEFAULT_TEXT_COLOR } };
    return styled;
  }
  if (styled.s === undefined || styled.s === null) {
    styled.s = { cl: { rgb: TABLE_DEFAULT_TEXT_COLOR } };
  }
  return styled;
};

const referencesExternalSource = (formula: unknown, sourceIds: string[]): boolean =>
  typeof formula === "string" &&
  sourceIds.some((eventId) => formula.includes(`${externalSourceSheetName(eventId)}!`));

const legacySnapshot = (rows: Record<string, string>[], columns: { id: string }[]): JsonRecord => {
  const cellData: JsonRecord = {};
  rows.forEach((row, rowIndex) => {
    const cells: JsonRecord = {};
    columns.forEach((column, columnIndex) => {
      const value = row[column.id];
      if (!nonEmptyString(value)) return;
      cells[String(columnIndex)] = value.startsWith("=") ? { f: value } : { v: value };
    });
    if (Object.keys(cells).length) cellData[String(rowIndex)] = cells;
  });
  return compactWorkbookSnapshot({
    sheets: { [TABLE_SHEET_ID]: { id: TABLE_SHEET_ID, cellData } },
    sheetOrder: [TABLE_SHEET_ID],
  });
};

const sourceWorkbookSnapshot = (document: TableDoc, columns: { id: string }[]): JsonRecord =>
  compactWorkbookSnapshot(
    isUniverTableDoc(document) ? document.snapshot : legacySnapshot(document.rows, columns),
  );

/**
 * Univer's formula engine operates within one workbook. A referenced table
 * is therefore represented by an ordinary, very-hidden worksheet while this
 * widget is mounted. Only the visible sheet is persisted, so the source data
 * remains owned by its own event document.
 */
const withExternalSourceSheets = (
  workbook: JsonRecord,
  sourceIds: string[],
  sources: ExternalTableSources,
  columns: { id: string }[],
): JsonRecord => {
  const mainSheetId = firstSheetId(workbook);
  const sheets = workbook.sheets as JsonRecord;
  const nextSheets: JsonRecord = { [mainSheetId]: sheets[mainSheetId] };
  const sheetOrder = [mainSheetId];

  for (const eventId of sourceIds) {
    const source = sources[eventId];
    // Do not create a placeholder sheet while the event is loading. Univer
    // will surface a normal #REF! briefly, then recalculate on the keyed
    // remount when the source sheet becomes available.
    if (!source) continue;
    const sourceSnapshot = sourceWorkbookSnapshot(source, columns);
    const sourceSheetId = firstSheetId(sourceSnapshot);
    const sourceSheets = sourceSnapshot.sheets as JsonRecord;
    const sourceSheet = clone(sourceSheets[sourceSheetId]) as JsonRecord;
    const sheetName = externalSourceSheetName(eventId);

    sourceSheet.id = sheetName;
    sourceSheet.name = sheetName;
    sourceSheet.hidden = 2; // WorksheetHiddenState.VERY_HIDDEN
    // Runtime-only source docs deliberately have no widget config. Their
    // maximum legal dimensions cover all table settings and formula ranges.
    sourceSheet.rowCount = 500;
    sourceSheet.columnCount = 26;
    nextSheets[sheetName] = sourceSheet;
    sheetOrder.push(sheetName);
  }

  return { ...workbook, sheetOrder, sheets: nextSheets };
};

/**
 * Adds display-only settings from the widget config immediately before a
 * snapshot is loaded. Row/column count is intentionally not persisted in the
 * event document; settings remain the one source of truth for it.
 */
export const hydrateWorkbookSnapshot = (
  document: TableDoc,
  options: TableSnapshotOptions,
  externalSources: ExternalTableSources = {},
): JsonRecord => {
  const compacted = compactWorkbookSnapshot(
    isUniverTableDoc(document) ? document.snapshot : legacySnapshot(document.rows, options.columns),
  );
  const sheetId = firstSheetId(compacted);
  const sheets = compacted.sheets as JsonRecord;
  const sheet = clone(sheets[sheetId]) as JsonRecord;
  const title = options.title?.trim() || "Table";

  sheet.id = sheetId;
  sheet.name = title;
  sheet.rowCount = options.rowCount;
  sheet.columnCount = options.columnCount;
  sheet.rowHeader = { width: 46, hidden: options.hideRowNumbers ? 1 : 0 };
  sheet.columnHeader = { height: 24, hidden: options.hideColumnHeaders ? 1 : 0 };
  // Univer otherwise gives a newly entered value its office-sheet black text
  // color. A sheet default affects future cells without replacing an explicit
  // color that an existing cell already carries.
  sheet.defaultStyle = {
    ...(isRecord(sheet.defaultStyle) ? sheet.defaultStyle : {}),
    cl: { rgb: TABLE_DEFAULT_TEXT_COLOR },
  };

  const externalFormulas = externalFormulasForDocument(document);
  const externalSourceIds = externalSourceIdsForDocument(document);
  if (Object.keys(externalFormulas).length) {
    const cellData = isRecord(sheet.cellData) ? sheet.cellData : {};
    for (const [key, formula] of Object.entries(externalFormulas)) {
      const coordinate = parseExternalCellKey(key);
      if (!coordinate) continue;
      const current = cellAt(cellData, coordinate.row, coordinate.column) ?? {};
      const nativeFormula = nativeFormulaForExternalFormula(formula);
      if (!nativeFormula) continue;
      const converted = withDefaultTextColor(current);
      converted.f = nativeFormula;
      delete converted.v;
      setCell(cellData, coordinate.row, coordinate.column, converted);
    }
    sheet.cellData = cellData;
  }

  // This also covers references already saved in native form before this
  // style fix was introduced. It affects the runtime snapshot immediately;
  // the compact event payload receives it on the next normal save.
  if (externalSourceIds.length) {
    const cellData = isRecord(sheet.cellData) ? sheet.cellData : {};
    for (const [rowText, cells] of indexedEntries(cellData)) {
      for (const [columnText, cell] of indexedEntries(cells)) {
        if (!referencesExternalSource(cell.f, externalSourceIds)) continue;
        setCell(cellData, Number(rowText), Number(columnText), withDefaultTextColor(cell));
      }
    }
    sheet.cellData = cellData;
  }

  const visibleWorkbook = {
    ...compacted,
    name: title,
    sheetOrder: [sheetId],
    sheets: { [sheetId]: sheet },
  };
  return withExternalSourceSheets(
    visibleWorkbook,
    externalSourceIds,
    externalSources,
    options.columns,
  );
};

/** Turn Univer's save result into the compact event payload. */
export const documentFromWorkbookSnapshot = (
  snapshot: unknown,
  externalSources: string[] = [],
): UniverTableDoc => ({
  version: TABLE_DOCUMENT_VERSION,
  snapshot: compactWorkbookSnapshot(snapshot),
  ...(externalSources.length ? { externalSources: [...new Set(externalSources)].sort() } : {}),
});

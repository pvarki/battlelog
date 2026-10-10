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

export const TABLE_DOCUMENT_VERSION = "battlelog-univer/v1";
export const TABLE_SHEET_ID = "main";
export const TABLE_WORKBOOK_ID = "battlelog-table";

type JsonRecord = Record<string, unknown>;

export type LegacyTableDoc = { rows: Record<string, string>[] };

export type UniverTableDoc = {
  version: typeof TABLE_DOCUMENT_VERSION;
  snapshot: JsonRecord;
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

/** Read current snapshots defensively, otherwise preserve the old table payload. */
export const parseTableDocument = (data: unknown): TableDoc => {
  if (isRecord(data) && data.version === TABLE_DOCUMENT_VERSION && isRecord(data.snapshot)) {
    return { version: TABLE_DOCUMENT_VERSION, snapshot: compactWorkbookSnapshot(data.snapshot) };
  }
  return parseLegacyRows(data);
};

export const emptyTableDocument = (): UniverTableDoc => ({
  version: TABLE_DOCUMENT_VERSION,
  snapshot: compactWorkbookSnapshot({}),
});

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

/**
 * Adds display-only settings from the widget config immediately before a
 * snapshot is loaded. Row/column count is intentionally not persisted in the
 * event document; settings remain the one source of truth for it.
 */
export const hydrateWorkbookSnapshot = (
  document: TableDoc,
  options: TableSnapshotOptions,
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

  return {
    ...compacted,
    name: title,
    sheetOrder: [sheetId],
    sheets: { [sheetId]: sheet },
  };
};

/** Turn Univer's save result into the compact event payload. */
export const documentFromWorkbookSnapshot = (snapshot: unknown): UniverTableDoc => ({
  version: TABLE_DOCUMENT_VERSION,
  snapshot: compactWorkbookSnapshot(snapshot),
});

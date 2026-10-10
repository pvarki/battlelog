import { describe, expect, test } from "vitest";
import {
  compactWorkbookSnapshot,
  documentFromWorkbookSnapshot,
  emptyTableDocument,
  hydrateWorkbookSnapshot,
  parseTableDocument,
  TABLE_DOCUMENT_VERSION,
  TABLE_SHEET_ID,
} from "./workbook.ts";

const options = {
  title: "Operations",
  rowCount: 40,
  columnCount: 8,
  hideRowNumbers: false,
  hideColumnHeaders: true,
  columns: [{ id: "A" }, { id: "B" }, { id: "C" }],
};

describe("Univer table document", () => {
  test("keeps only the configured first sheet and sparse information", () => {
    const compact = compactWorkbookSnapshot({
      id: "workbook-1",
      name: "Operations",
      appVersion: "1.0.4",
      locale: "en-US",
      styles: { styled: { bl: 1 } },
      resources: { drawing: "removed" },
      sheetOrder: ["main", "other"],
      sheets: {
        main: {
          id: "main",
          rowCount: 500,
          columnCount: 26,
          scrollTop: 200,
          cellData: {
            0: { 0: { v: "Vehicle" }, 1: { v: "" }, 2: { v: "", s: "styled" } },
            7: { 3: { f: "=SUM(A1:A2)", v: 4 } },
            9: { 0: { v: null, t: 2 } },
          },
          rowData: { 7: { h: 32 } },
          columnData: { 2: { w: 160 } },
        },
        other: {
          id: "other",
          cellData: { 0: { 0: { v: "must not persist" } } },
        },
      },
    });

    expect(compact.sheetOrder).toEqual(["main"]);
    expect(compact.resources).toBeUndefined();
    expect(compact.sheets).toEqual({
      main: expect.objectContaining({
        id: "main",
        cellData: {
          0: { 0: { v: "Vehicle" }, 2: { v: "", s: "styled" } },
          7: { 3: { f: "=SUM(A1:A2)", v: 4 } },
        },
        rowData: { 7: { h: 32 } },
        columnData: { 2: { w: 160 } },
      }),
    });
    const main = (compact.sheets as Record<string, Record<string, unknown>>).main;
    expect(main?.rowCount).toBeUndefined();
    expect(main?.columnCount).toBeUndefined();
    expect(main?.scrollTop).toBeUndefined();
  });

  test("retains numeric values including zero", () => {
    const compact = compactWorkbookSnapshot({
      sheets: { main: { cellData: { 0: { 0: { t: 2, v: 0 }, 1: { t: 2, v: 42 } } } } },
      sheetOrder: ["main"],
    });

    expect(compact.sheets).toEqual({
      main: expect.objectContaining({ cellData: { 0: { 0: { t: 2, v: 0 }, 1: { t: 2, v: 42 } } } }),
    });
  });

  test("gets visible row and column dimensions from widget settings", () => {
    const hydrated = hydrateWorkbookSnapshot(emptyTableDocument(), options);
    const sheet = (hydrated.sheets as Record<string, Record<string, unknown>>)[TABLE_SHEET_ID];

    expect(hydrated.name).toBe("Operations");
    expect(sheet).toMatchObject({
      id: TABLE_SHEET_ID,
      rowCount: 40,
      columnCount: 8,
      rowHeader: { width: 46, hidden: 0 },
      columnHeader: { height: 24, hidden: 1 },
      cellData: {},
    });
  });

  test("migrates a legacy rows payload on first Univer save", () => {
    const legacy = parseTableDocument({
      rows: [{ A: "Radio", B: "5", C: "=B1*10" }, {}, { A: "Vehicle" }],
    });
    const hydrated = hydrateWorkbookSnapshot(legacy, options);
    const saved = documentFromWorkbookSnapshot(hydrated);

    expect(saved.version).toBe(TABLE_DOCUMENT_VERSION);
    expect(saved.snapshot.sheets).toEqual({
      main: expect.objectContaining({
        cellData: {
          0: { 0: { v: "Radio" }, 1: { v: "5" }, 2: { f: "=B1*10" } },
          2: { 0: { v: "Vehicle" } },
        },
      }),
    });
  });

  test("uses legacy column ids while converting an older configured table", () => {
    const legacy = parseTableDocument({ rows: [{ item: "Battery", quantity: "8" }] });
    const hydrated = hydrateWorkbookSnapshot(legacy, {
      ...options,
      columns: [{ id: "item" }, { id: "quantity" }],
    });
    const main = (hydrated.sheets as Record<string, Record<string, unknown>>).main;

    expect(main?.cellData).toEqual({ 0: { 0: { v: "Battery" }, 1: { v: "8" } } });
  });

  test("parses a malformed document as an empty legacy table", () => {
    expect(parseTableDocument({ version: TABLE_DOCUMENT_VERSION, snapshot: null })).toEqual({
      rows: [],
    });
  });
});

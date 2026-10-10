import { Box, Text, Textarea } from "@mantine/core";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useWidgetDocument } from "../../dashboard/useEventDocument.ts";
import { evaluateFormula } from "./formula.ts";
import {
  type TableConfig,
  tableColumnCount,
  tableColumns,
  tableRowCount,
  widgetDocument,
} from "./widget.ts";

const GRID_BORDER = "1px solid var(--mantine-color-dark-3)";
const GRID_HEADER_BORDER = "1px solid var(--mantine-color-dark-2)";
const ROW_NUMBER_WIDTH = 48;
const COLUMN_WIDTH = 112;
const HORIZONTAL_SCROLL_MIN_WIDTH_FACTOR = 0.5;
const RESIZE_EDGE_THRESHOLD = 12;
const RESIZE_EDGE_GROWTH_PER_FRAME = 2;
const CELL_FONT_SIZE = 12;
const CELL_LINE_HEIGHT = 16;
const MAX_ROW_HEIGHT = 120;
const CELL_TOP_PADDING = 3;
const CELL_BOTTOM_PADDING = 0;
const MIN_ROW_HEIGHT = CELL_LINE_HEIGHT + CELL_TOP_PADDING * 2 + 1;
const DEFAULT_ROW_HEIGHT = MIN_ROW_HEIGHT;
const ROW_HEIGHT_KEY = "__rowHeight";
const ROW_RESIZE_HIT_SLOP = 3;
const cellKey = (rowIndex: number, columnIndex: number) => `${rowIndex}:${columnIndex}`;
const isNumericCellValue = (value: string): boolean => /^-?\d+(?:[.,]\d+)?$/.test(value.trim());
const isMinimumSingleLineCell = (height: number, value: string): boolean =>
  height <= MIN_ROW_HEIGHT && !value.includes("\n");
const cellPaddingBottom = (height: number, value: string): number =>
  isMinimumSingleLineCell(height, value) ? CELL_TOP_PADDING : CELL_BOTTOM_PADDING;
const rowResizeHandleStyle = {
  position: "absolute",
  right: 0,
  bottom: 0,
  left: 0,
  height: ROW_RESIZE_HIT_SLOP * 2 + 1,
  cursor: "row-resize",
  transform: "translateY(50%)",
  zIndex: 2,
} as const;

const rowHasValue = (row: Record<string, string> | undefined): row is Record<string, string> =>
  !!row &&
  Object.entries(row).some(([key, cell]) =>
    key === ROW_HEIGHT_KEY ? cell.trim() !== "" : !key.startsWith("__") && cell.trim() !== "",
  );

const rowHeight = (row: Record<string, string>): number => {
  const height = Number(row[ROW_HEIGHT_KEY]);
  return Number.isFinite(height)
    ? Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, height))
    : DEFAULT_ROW_HEIGHT;
};

const compactRows = (rows: Record<string, string>[]): Record<string, string>[] => {
  let lastContentIndex = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rowHasValue(rows[i])) {
      lastContentIndex = i;
      break;
    }
  }
  return lastContentIndex === -1 ? [] : rows.slice(0, lastContentIndex + 1);
};

const TableView = ({ config, dashboardIsTemplate, updateConfig }: WidgetViewProps<TableConfig>) => {
  const configuredRows = tableRowCount(config.rowCount);
  const columns = useMemo(
    () => tableColumns(tableColumnCount(config.columnCount)),
    [config.columnCount],
  );
  const cellRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const [draftRowHeights, setDraftRowHeights] = useState(new Map<number, number>());
  const { value, update, status } = useWidgetDocument({
    config,
    updateConfig,
    dashboardIsTemplate,
    document: widgetDocument,
  });

  // ponytail: whole-doc last-writer-wins, same as the status widget — two
  // screens editing different rows within one save window can drop each
  // other's edit (SSE catch-up self-heals). Per-row events if tables get busy.
  const setCell = (rowIndex: number, columnId: string, text: string) => {
    const rows = Array.from({ length: Math.max(value.rows.length, rowIndex + 1) }, (_, i) => ({
      ...(value.rows[i] ?? {}),
    }));
    const row = rows[rowIndex] ?? {};
    row[columnId] = text;
    rows[rowIndex] = row;
    update({
      rows: compactRows(rows),
    });
  };

  const setRowHeight = (rowIndex: number, height: number) => {
    const rows = Array.from({ length: Math.max(value.rows.length, rowIndex + 1) }, (_, i) => ({
      ...(value.rows[i] ?? {}),
    }));
    const row = rows[rowIndex] ?? {};
    const nextHeight = Math.round(Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, height)));
    if (nextHeight === DEFAULT_ROW_HEIGHT) {
      delete row[ROW_HEIGHT_KEY];
    } else {
      row[ROW_HEIGHT_KEY] = String(nextHeight);
    }
    rows[rowIndex] = row;
    update({ rows: compactRows(rows) });
  };

  const startRowResize = (rowIndex: number, height: number, event: ReactPointerEvent) => {
    if (disabled) return;

    event.preventDefault();
    event.stopPropagation();
    const scrollBox = scrollBoxRef.current;
    const startY = event.clientY;
    let currentClientY = event.clientY;
    let edgeGrowth = 0;
    let frame: number | undefined;
    let nextHeight = height;
    const clampHeight = (value: number) =>
      Math.round(Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, value)));
    const updateDraft = (sync = false) => {
      const heightBefore = nextHeight;
      nextHeight = clampHeight(height + currentClientY - startY + edgeGrowth);
      if (nextHeight === heightBefore) return 0;

      const apply = () =>
        setDraftRowHeights((current) => new Map(current).set(rowIndex, nextHeight));
      if (sync) {
        flushSync(apply);
      } else {
        apply();
      }
      return nextHeight - heightBefore;
    };
    const tick = () => {
      if (
        scrollBox &&
        currentClientY >= scrollBox.getBoundingClientRect().bottom - RESIZE_EDGE_THRESHOLD
      ) {
        edgeGrowth += RESIZE_EDGE_GROWTH_PER_FRAME;
        scrollBox.scrollTop += updateDraft(true);
      }
      frame = window.requestAnimationFrame(tick);
    };
    const onMove = (moveEvent: PointerEvent) => {
      currentClientY = moveEvent.clientY;
      updateDraft();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      setDraftRowHeights((current) => {
        const next = new Map(current);
        next.delete(rowIndex);
        return next;
      });
      setRowHeight(rowIndex, nextHeight);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    frame = window.requestAnimationFrame(tick);
  };

  const focusCell = (rowIndex: number, columnIndex: number) => {
    const nextRow = Math.min(displayedRows - 1, Math.max(0, rowIndex));
    const nextColumn = Math.min(columns.length - 1, Math.max(0, columnIndex));
    const next = cellRefs.current.get(cellKey(nextRow, nextColumn));
    if (!next) return;

    next.focus();
    const end = next.value.length;
    next.setSelectionRange(end, end);
  };

  const handleCellKeyDown = (
    rowIndex: number,
    columnIndex: number,
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const input = event.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;
    const beforeCursor = value.slice(0, start);
    const afterCursor = value.slice(end);
    let next: { row: number; column: number } | null = null;

    if (event.key === "ArrowLeft" && start === 0) {
      next = { row: rowIndex, column: columnIndex - 1 };
    }
    if (event.key === "ArrowRight" && end === value.length) {
      next = { row: rowIndex, column: columnIndex + 1 };
    }
    if (event.key === "ArrowUp" && !beforeCursor.includes("\n")) {
      next = { row: rowIndex - 1, column: columnIndex };
    }
    if (event.key === "ArrowDown" && !afterCursor.includes("\n")) {
      next = { row: rowIndex + 1, column: columnIndex };
    }

    if (!next) return;
    event.preventDefault();
    focusCell(next.row, next.column);
  };

  const displayedRows = configuredRows;
  const disabled = status === "loading" || status === "unavailable";
  const showRowNumbers = !config.hideRowNumbers;
  const showColumnHeaders = !config.hideColumnHeaders;
  const fullTableWidth = columns.length * COLUMN_WIDTH + (showRowNumbers ? ROW_NUMBER_WIDTH : 0);

  useEffect(() => {
    if (value.rows.length > configuredRows) {
      update({ rows: compactRows(value.rows.slice(0, configuredRows)) });
    }
  }, [configuredRows, update, value.rows]);

  return (
    <Box h="100%" style={{ display: "grid", gridTemplateRows: "1fr auto", minHeight: 0 }}>
      <Box ref={scrollBoxRef} style={{ overflow: "auto", minHeight: 0 }}>
        <table
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            minWidth: fullTableWidth * HORIZONTAL_SCROLL_MIN_WIDTH_FACTOR,
            width: "100%",
            tableLayout: "fixed",
          }}
        >
          {showColumnHeaders && (
            <thead>
              <tr>
                {showRowNumbers && (
                  <th
                    scope="col"
                    style={{
                      position: "sticky",
                      top: 0,
                      left: 0,
                      zIndex: 3,
                      width: ROW_NUMBER_WIDTH,
                      height: 28,
                      background: "var(--mantine-color-dark-7)",
                      borderRight: GRID_HEADER_BORDER,
                      borderBottom: GRID_HEADER_BORDER,
                    }}
                  />
                )}
                {columns.map((col, columnIndex) => (
                  <th
                    key={col.id}
                    scope="col"
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                      width: COLUMN_WIDTH,
                      height: 28,
                      background: "var(--mantine-color-dark-7)",
                      borderRight:
                        columnIndex === columns.length - 1 ? undefined : GRID_HEADER_BORDER,
                      borderBottom: GRID_HEADER_BORDER,
                      color: "var(--mantine-color-dimmed)",
                      fontSize: CELL_FONT_SIZE,
                      fontWeight: 600,
                      textAlign: "center",
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {Array.from({ length: displayedRows }, (_, rowIndex) => {
              const row = value.rows[rowIndex] ?? {};
              const height = draftRowHeights.get(rowIndex) ?? rowHeight(row);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: spreadsheet rows are position-addressed
                <tr key={rowIndex}>
                  {showRowNumbers && (
                    <th
                      scope="row"
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                        width: ROW_NUMBER_WIDTH,
                        height,
                        background: "var(--mantine-color-dark-7)",
                        borderRight: GRID_HEADER_BORDER,
                        borderBottom: GRID_BORDER,
                        color: "var(--mantine-color-dimmed)",
                        fontSize: CELL_FONT_SIZE,
                        fontWeight: 500,
                        textAlign: "center",
                      }}
                    >
                      {rowIndex + 1}
                      <Box
                        aria-hidden
                        onPointerDown={(event) => startRowResize(rowIndex, height, event)}
                        style={rowResizeHandleStyle}
                      />
                    </th>
                  )}
                  {columns.map((col, columnIndex) => {
                    const rawCellValue =
                      col.kind === "formula"
                        ? evaluateFormula(col.formula ?? "", row, columns)
                        : (row[col.id] ?? "");
                    const paddingTop = CELL_TOP_PADDING;
                    const paddingBottom = cellPaddingBottom(height, rawCellValue);

                    return (
                      <td
                        key={col.id}
                        style={{
                          height,
                          padding: 0,
                          borderRight: columnIndex === columns.length - 1 ? undefined : GRID_BORDER,
                          borderBottom: GRID_BORDER,
                          background: "var(--mantine-color-dark-8)",
                          position: "relative",
                        }}
                      >
                        {col.kind === "formula" ? (
                          <Text
                            px={6}
                            c="dimmed"
                            style={{
                              boxSizing: "border-box",
                              display: "block",
                              fontSize: CELL_FONT_SIZE,
                              height: height - 1,
                              overflow: "hidden",
                              lineHeight: `${CELL_LINE_HEIGHT}px`,
                              paddingTop,
                              paddingBottom,
                              textAlign: isNumericCellValue(rawCellValue) ? "right" : "left",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {rawCellValue}
                          </Text>
                        ) : (
                          <Textarea
                            ref={(element) => {
                              const key = cellKey(rowIndex, columnIndex);
                              if (element) {
                                cellRefs.current.set(key, element);
                              } else {
                                cellRefs.current.delete(key);
                              }
                            }}
                            size="xs"
                            variant="unstyled"
                            value={rawCellValue}
                            onChange={(event) => {
                              event.currentTarget.scrollTop = 0;
                              setCell(rowIndex, col.id, event.currentTarget.value);
                            }}
                            onKeyDown={(event) => handleCellKeyDown(rowIndex, columnIndex, event)}
                            onScroll={(event) => {
                              event.currentTarget.scrollTop = 0;
                            }}
                            disabled={disabled}
                            styles={{
                              root: {
                                height: height - 1,
                              },
                              wrapper: {
                                height: "100%",
                                overflow: "hidden",
                              },
                              input: {
                                height: height - 1,
                                minHeight: height - 1,
                                boxSizing: "border-box",
                                display: "block",
                                overflow: "hidden",
                                paddingInline: 6,
                                paddingTop,
                                paddingBottom,
                                borderRadius: 0,
                                fontSize: CELL_FONT_SIZE,
                                lineHeight: `${CELL_LINE_HEIGHT}px`,
                                resize: "none",
                                textAlign: isNumericCellValue(rawCellValue) ? "right" : "left",
                              },
                            }}
                          />
                        )}
                        <Box
                          aria-hidden
                          onPointerDown={(event) => startRowResize(rowIndex, height, event)}
                          style={rowResizeHandleStyle}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Box>
      <Text c="dimmed" fz="xs" ta="right" px="xs" py={3} mih="1.2em" role="status">
        {DOC_STATUS_LABEL[status]}
      </Text>
    </Box>
  );
};

export default TableView;

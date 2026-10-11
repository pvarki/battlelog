import { Box, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useWidgetDocument } from "../../dashboard/useEventDocument.ts";
import {
  type TableConfig,
  tableColumnCount,
  tableColumns,
  tableRowCount,
  widgetDocument,
} from "./widget.ts";
import {
  documentFromWorkbookSnapshot,
  hydrateWorkbookSnapshot,
  type TableDoc,
} from "./workbook.ts";

type SpreadsheetProps = {
  document: TableDoc;
  config: TableConfig;
  /** `final` is only used while unmounting, when the debounce can no longer run. */
  onDocumentChange: (document: TableDoc, final?: boolean) => void;
};

// Univer and JSON transport may enumerate otherwise identical object keys in
// different orders. A canonical signature keeps our own SSE echo from looking
// like a remote workbook revision (which would recreate the whole editor).
const documentSignature = (document: TableDoc): string => {
  const stringify = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stringify).join(",")}]`;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stringify(record[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return stringify(document);
};

/**
 * The interactive Univer instance deliberately lives behind the table widget's
 * lazy boundary. A new instance is made only when the event document comes
 * from another editor or a display setting changes; local edits retain the
 * native selection and undo stack.
 */
const Spreadsheet = ({ document, config, onDocumentChange }: SpreadsheetProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onDocumentChange);
  changeRef.current = onDocumentChange;

  // This component is keyed by display settings and remote revisions below.
  // Keeping the initial snapshot in a ref means a local event-log update does
  // not tear down the editor that just produced it.
  const initialSnapshot = useRef<ReturnType<typeof hydrateWorkbookSnapshot> | null>(null);
  if (!initialSnapshot.current) {
    const columnCount = tableColumnCount(config.columnCount);
    const legacyColumns = [
      ...config.columns.slice(0, columnCount),
      ...tableColumns(columnCount).slice(config.columns.length),
    ];
    initialSnapshot.current = hydrateWorkbookSnapshot(document, {
      title: config.title,
      rowCount: tableRowCount(config.rowCount),
      columnCount,
      hideRowNumbers: config.hideRowNumbers,
      hideColumnHeaders: config.hideColumnHeaders,
      columns: legacyColumns,
    });
  }

  // The screen has one sheet, no sheet bar, and no import/export or chart
  // plugins. `documentFromWorkbookSnapshot` also enforces this on every save.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const snapshot = initialSnapshot.current;
    if (!snapshot) return;

    let disposed = false;
    const container = globalThis.document.createElement("div");
    container.style.height = "100%";
    container.style.minHeight = "0";
    host.append(container);

    let disposeUniver: (() => void) | undefined;
    void import("./univer.ts").then(({ createTableUniver }) => {
      if (disposed) return;
      const { univer, univerAPI, workbook } = createTableUniver(
        container,
        snapshot,
        config.hideWidgetHeader,
      );
      if (disposed) {
        univer.dispose();
        container.remove();
        return;
      }

      let ready = false;
      let saveFrame: number | undefined;
      let formulaBarTimer: ReturnType<typeof setTimeout> | undefined;
      let formulaBarArmed = false;
      let cellEditActive = false;
      let lastSaved = documentSignature(documentFromWorkbookSnapshot(workbook.save()));
      const readyFrame = requestAnimationFrame(() => {
        // Formula and layout plugins can issue setup commands just after mount.
        // They must not create an empty event before the user changes a cell.
        lastSaved = documentSignature(documentFromWorkbookSnapshot(workbook.save()));
        ready = true;
      });
      const persistWorkbook = (force = false) => {
        saveFrame = undefined;
        if ((disposed && !force) || !ready) return;
        const next = documentFromWorkbookSnapshot(workbook.save());
        const nextSignature = documentSignature(next);
        if (nextSignature === lastSaved) return;
        lastSaved = nextSignature;
        // Normal edits use the document hook's short debounce. The one
        // exception is unmounting: no future timer is guaranteed to run.
        changeRef.current(next, force);
      };
      const queuePersistence = () => {
        // Sheet commands are reported while Univer is applying them. Taking
        // the snapshot in the next frame avoids reading the pre-edit cell
        // state (which made a just-edited cell look empty after a reload).
        if (disposed || saveFrame !== undefined) return;
        saveFrame = requestAnimationFrame(() => persistWorkbook());
      };
      const commitFormulaBar = () => {
        formulaBarTimer = undefined;
        formulaBarArmed = false;
        // The formula bar holds an edit in Univer's editor buffer until Enter
        // or the tick button is used. That means `workbook.save()` still sees
        // the old cell even though the user has finished typing. Commit an
        // idle formula-bar edit first; its normal value-change event then
        // follows the same debounced persistence path as an in-cell edit.
        void univerAPI
          .executeCommand("sheet.operation.set-cell-edit-visible", {
            visible: false,
            unitId: workbook.getId(),
          })
          .then(queuePersistence);
      };
      const onFormulaBarInput = (_event: Event) => {
        // Univer portals the editable formula field outside the workbook DOM
        // tree. A document-level listener is therefore required. The flag is
        // armed only by this workbook's visual formula bar, so a second table
        // on the same dashboard cannot react to this editor's keystrokes.
        if (!formulaBarArmed || !globalThis.document.activeElement?.id.endsWith("FORMULA_BAR")) {
          return;
        }
        clearTimeout(formulaBarTimer);
        formulaBarTimer = setTimeout(commitFormulaBar, 2000);
      };
      const trackFormulaBarFocus = (event: PointerEvent) => {
        if (!(event.target instanceof Element)) return;
        formulaBarArmed = Boolean(event.target.closest('[data-u-comp="formula-bar"]'));
      };
      const startAppendingToCell = (event: KeyboardEvent) => {
        // A click only selects. The first printable key enters edit mode at
        // the end of the selected cell, matching the direct-entry flow needed
        // by the dashboard rather than replacing a cell on the first key.
        if (
          cellEditActive ||
          event.defaultPrevented ||
          event.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.key.length !== 1
        ) {
          return;
        }
        // Univer handles its own first-key editor transition asynchronously.
        // Consume this native event, then insert it after its F2 path has put
        // the selection at the end; otherwise the first character lands at
        // offset zero before that transition completes.
        event.preventDefault();
        event.stopPropagation();
        cellEditActive = true;
        void univerAPI
          .executeCommand("sheet.operation.set-cell-edit-visible-f2", {
            visible: true,
            // Univer's DeviceInputEventType.Keyboard and KeyCode.F2. Asking
            // it to enter through its F2 path preserves the current cell and
            // puts the caret at its end before this key is inserted.
            eventType: 4,
            keycode: 113,
            unitId: workbook.getId(),
          })
          .then((opened) => {
            if (!opened) {
              cellEditActive = false;
              return;
            }
            globalThis.document.execCommand("insertText", false, event.key);
          });
      };
      const refreshSelectionAfterExternalClick = (event: PointerEvent) => {
        if (!(event.target instanceof Node) || container.contains(event.target)) return;
        // Univer fades the selection when another dashboard control receives
        // focus. Reapplying the existing active cell redraws its outline but
        // deliberately leaves focus with the control the user clicked.
        requestAnimationFrame(() => {
          if (disposed) return;
          const sheet = workbook.getActiveSheet();
          const activeCell = sheet?.getActiveCell();
          if (sheet && activeCell) sheet.setActiveSelection(activeCell);
        });
      };
      container.addEventListener("pointerdown", trackFormulaBarFocus, true);
      container.addEventListener("keydown", startAppendingToCell, true);
      globalThis.document.addEventListener("pointerdown", refreshSelectionAfterExternalClick, true);
      globalThis.document.addEventListener("input", onFormulaBarInput, true);
      // `SheetValueChanged` is the typed-sheet event. In particular it fires
      // for a number committed from the in-cell editor, which is not reliable
      // to infer from the generic command stream alone.
      const valueChanges = univerAPI.addEvent(univerAPI.Event.SheetValueChanged, queuePersistence);
      const edits = univerAPI.addEvent(univerAPI.Event.SheetEditEnded, (event) => {
        cellEditActive = false;
        // Ignore Esc/cancel: only a confirmed edit can have left spreadsheet
        // data worth serializing. The value-change event captures the final
        // value even when Univer emits this edit-ended event slightly earlier.
        if (event.isConfirm) queuePersistence();
      });
      const changes = workbook.onCommandExecuted(() => queuePersistence());
      disposeUniver = () => {
        changes.dispose();
        edits.dispose();
        valueChanges.dispose();
        container.removeEventListener("pointerdown", trackFormulaBarFocus, true);
        container.removeEventListener("keydown", startAppendingToCell, true);
        globalThis.document.removeEventListener(
          "pointerdown",
          refreshSelectionAfterExternalClick,
          true,
        );
        globalThis.document.removeEventListener("input", onFormulaBarInput, true);
        cancelAnimationFrame(readyFrame);
        clearTimeout(formulaBarTimer);
        if (saveFrame !== undefined) {
          cancelAnimationFrame(saveFrame);
          persistWorkbook(true);
        }
        // Univer renders a nested React root. Deferring disposal avoids tearing
        // it down in the middle of React's parent cleanup phase.
        queueMicrotask(() => {
          univer.dispose();
          container.remove();
        });
      };
    });

    return () => {
      disposed = true;
      disposeUniver?.();
      if (!disposeUniver) container.remove();
    };
  }, [config.hideWidgetHeader]);

  return <Box ref={hostRef} h="100%" style={{ minHeight: 0, overflow: "hidden" }} />;
};

const TableView = ({ config, dashboardIsTemplate, updateConfig }: WidgetViewProps<TableConfig>) => {
  const { value, update, flush, status } = useWidgetDocument({
    config,
    updateConfig,
    dashboardIsTemplate,
    document: widgetDocument,
  });
  const savedByThisView = useRef<string | undefined>(undefined);
  const renderedDocument = useRef(documentSignature(value));
  // The first event fetch supplies the document used to mount Univer. It is
  // not a remote edit and must not cause a second, destructive mount.
  const initialDocumentPending = useRef(Boolean(config.eventId));
  const [remoteRevision, setRemoteRevision] = useState(0);
  const valueSignature = documentSignature(value);

  // `useEventDocument` reflects local saves and SSE updates through the same
  // value. Do not recreate Univer after our own save, but do reload when an
  // external editor wins the event-chain update.
  useEffect(() => {
    if (valueSignature === renderedDocument.current) return;
    renderedDocument.current = valueSignature;
    if (valueSignature === savedByThisView.current) {
      initialDocumentPending.current = false;
      return;
    }
    if (initialDocumentPending.current) {
      initialDocumentPending.current = false;
      return;
    }
    setRemoteRevision((revision) => revision + 1);
  }, [valueSignature]);

  const onDocumentChange = (next: TableDoc, final = false) => {
    savedByThisView.current = documentSignature(next);
    renderedDocument.current = savedByThisView.current;
    update(next);
    if (final) flush();
  };

  const blocked = status === "loading" || status === "unavailable";
  const tableKey = [
    remoteRevision,
    tableColumnCount(config.columnCount),
    tableRowCount(config.rowCount),
    config.hideRowNumbers,
    config.hideColumnHeaders,
    config.hideWidgetHeader,
    config.title ?? "",
  ].join(":");

  return (
    <Box
      h="100%"
      style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", minHeight: 0 }}
    >
      {blocked ? (
        <Box p="sm">
          <Text c="dimmed" fz="sm">
            {DOC_STATUS_LABEL[status]}
          </Text>
        </Box>
      ) : (
        <Spreadsheet
          key={tableKey}
          document={value}
          config={config}
          onDocumentChange={onDocumentChange}
        />
      )}
      {!blocked && (
        <Text c="dimmed" fz="xs" ta="right" px="xs" py={3} mih="1.2em" role="status">
          {DOC_STATUS_LABEL[status]}
        </Text>
      )}
    </Box>
  );
};

export default TableView;

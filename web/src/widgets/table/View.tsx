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
  onDocumentChange: (document: TableDoc, flush?: boolean) => void;
};

const documentSignature = (document: TableDoc): string => JSON.stringify(document);

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
      const { univer, univerAPI, workbook } = createTableUniver(container, snapshot);
      if (disposed) {
        univer.dispose();
        container.remove();
        return;
      }

      let ready = false;
      let saveFrame: number | undefined;
      let flushAfterSave = false;
      let lastSaved = documentSignature(documentFromWorkbookSnapshot(workbook.save()));
      const readyFrame = requestAnimationFrame(() => {
        // Formula and layout plugins can issue setup commands just after mount.
        // They must not create an empty event before the user changes a cell.
        lastSaved = documentSignature(documentFromWorkbookSnapshot(workbook.save()));
        ready = true;
      });
      const persistWorkbook = (force = false) => {
        saveFrame = undefined;
        const flush = flushAfterSave;
        flushAfterSave = false;
        if ((disposed && !force) || !ready) return;
        const next = documentFromWorkbookSnapshot(workbook.save());
        const nextSignature = documentSignature(next);
        if (nextSignature === lastSaved) return;
        lastSaved = nextSignature;
        changeRef.current(next, flush);
      };
      const queuePersistence = (flush = false) => {
        // Sheet commands are reported while Univer is applying them. Taking
        // the snapshot in the next frame avoids reading the pre-edit cell
        // state (which made a just-edited cell look empty after a reload).
        flushAfterSave ||= flush;
        if (disposed || saveFrame !== undefined) return;
        saveFrame = requestAnimationFrame(() => persistWorkbook());
      };
      // `SheetValueChanged` is the typed-sheet event. In particular it fires
      // for a number committed from the in-cell editor, which is not reliable
      // to infer from the generic command stream alone.
      const valueChanges = univerAPI.addEvent(univerAPI.Event.SheetValueChanged, () =>
        queuePersistence(),
      );
      const edits = univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () =>
        queuePersistence(true),
      );
      const changes = workbook.onCommandExecuted(() => queuePersistence());
      disposeUniver = () => {
        changes.dispose();
        edits.dispose();
        valueChanges.dispose();
        cancelAnimationFrame(readyFrame);
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
  }, []);

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
  const [remoteRevision, setRemoteRevision] = useState(0);
  const valueSignature = documentSignature(value);

  // `useEventDocument` reflects local saves and SSE updates through the same
  // value. Do not recreate Univer after our own save, but do reload when an
  // external editor wins the event-chain update.
  useEffect(() => {
    if (valueSignature === renderedDocument.current) return;
    renderedDocument.current = valueSignature;
    if (valueSignature === savedByThisView.current) return;
    setRemoteRevision((revision) => revision + 1);
  }, [valueSignature]);

  const onDocumentChange = (next: TableDoc, saveImmediately = false) => {
    savedByThisView.current = documentSignature(next);
    renderedDocument.current = savedByThisView.current;
    update(next);
    if (saveImmediately) flush();
  };

  const blocked = status === "loading" || status === "unavailable";
  const tableKey = [
    remoteRevision,
    tableColumnCount(config.columnCount),
    tableRowCount(config.rowCount),
    config.hideRowNumbers,
    config.hideColumnHeaders,
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

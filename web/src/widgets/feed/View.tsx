import { ActionIcon, Badge, Box, Center, Loader, Table, Text } from "@mantine/core";
import { IconMaximize } from "@tabler/icons-react";
import {
  lazy,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useState,
} from "react";
import type { EventResponse } from "../../api.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { useLiveEvents } from "../../live-events.ts";
import { StaleNotice } from "../../StaleNotice.tsx";
import { formatShortDateTime } from "../../time.ts";
import {
  activeFilters,
  columnWidth,
  dataFieldsOf,
  dataValue,
  type FeedColumn,
  type FeedConfig,
  type Field,
  labelFor,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  matchesFeed,
  nextDataField,
  queryFor,
} from "./widget.ts";

const RESIZE_HIT_WIDTH = 9;

const CELL: Record<Field, (e: EventResponse) => ReactNode> = {
  time: (e) => formatShortDateTime(e.eventTime ?? e.createdAt),
  header: (e) => e.header,
  type: (e) => (e.type ? <Badge variant="light">{e.type}</Badge> : null),
  tags: (e) => e.tags?.join(", "),
  admiralty: (e) => [e.admiraltyReliability, e.admiraltyAccuracy].filter(Boolean).join(""),
  createdBy: (e) => e.createdBy,
};

const cell = (col: FeedColumn, e: EventResponse): ReactNode =>
  col.source === "data" ? dataValue(e.data, col.dataPath) : CELL[col.source](e);

export const FeedTable = ({
  columns,
  events,
  arrived,
  onRowClick,
  onColumnWidthChange,
  onColumnFieldChange,
}: {
  columns: FeedColumn[];
  events: EventResponse[];
  /** Row ids that came in on the live stream; those rows wash once on arrival. */
  arrived?: ReadonlySet<string>;
  onRowClick?: (event: EventResponse) => void;
  onColumnWidthChange?: (columnId: string, width: number) => void;
  /** Cycle a data column to another field. Absent = columns are not tappable. */
  onColumnFieldChange?: (columnId: string, dataPath: string) => void;
}) => {
  // Which data fields exist depends on what is in the feed right now, so it is
  // read from the rows on every render rather than configured.
  const dataFields = dataFieldsOf(events);
  const totalWidth = columns.reduce((sum, col) => sum + columnWidth(col), 0);
  const startColumnResize = (col: FeedColumn, event: ReactPointerEvent) => {
    if (!onColumnWidthChange) return;

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidth(col);
    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX),
      );
      onColumnWidthChange(col.id, nextWidth);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return events.length === 0 ? (
    <Text c="dimmed" fz="sm">
      No matching events.
    </Text>
  ) : (
    <Table
      fz="xs"
      striped
      highlightOnHover
      verticalSpacing={4}
      stickyHeader
      style={{ minWidth: "100%", tableLayout: "fixed", width: totalWidth }}
    >
      <colgroup>
        {columns.map((col) => (
          <col key={col.id} style={{ width: columnWidth(col) }} />
        ))}
      </colgroup>
      <Table.Thead>
        <Table.Tr>
          {columns.map((col) => (
            <Table.Th
              key={col.id}
              style={{
                position: "relative",
                cursor: onColumnFieldChange && col.source === "data" ? "pointer" : undefined,
                userSelect: "none",
              }}
              // Tapping a data column moves it to the next field the rows carry.
              // A feed mixing form entries with ingested messages has no single
              // right field, so the choice belongs where the data is visible.
              onClick={
                onColumnFieldChange && col.source === "data"
                  ? () => onColumnFieldChange(col.id, nextDataField(col.dataPath, dataFields))
                  : undefined
              }
              title={
                onColumnFieldChange && col.source === "data"
                  ? dataFields.length
                    ? `Tap to show the next field: ${dataFields.join(", ")}`
                    : "No data fields in these events"
                  : undefined
              }
            >
              {labelFor(col)}
              {onColumnWidthChange && (
                <Box
                  aria-hidden
                  onPointerDown={(event) => startColumnResize(col, event)}
                  style={{
                    position: "absolute",
                    top: 0,
                    right: -Math.floor(RESIZE_HIT_WIDTH / 2),
                    bottom: 0,
                    width: RESIZE_HIT_WIDTH,
                    cursor: "col-resize",
                    zIndex: 1,
                  }}
                />
              )}
              {onColumnWidthChange && (
                <Box
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 0,
                    bottom: 6,
                    width: 1,
                    background: "var(--mantine-color-dark-3)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {events.map((event) => (
          <Table.Tr
            key={event.eventId}
            className={arrived?.has(event.id) ? "row-arrived" : undefined}
            onClick={onRowClick && (() => onRowClick(event))}
            style={onRowClick && { cursor: "pointer" }}
          >
            {columns.map((col) => (
              <Table.Td key={col.id}>{cell(col, event)}</Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
};

const FeedFullscreen = lazy(() => import("./Fullscreen.tsx"));

const FeedView = ({ config, updateConfig }: WidgetViewProps<FeedConfig>) => {
  const [fullscreen, setFullscreen] = useState(false);
  // Mounted once and kept: unmounting on close would skip the exit transition.
  const [everOpened, setEverOpened] = useState(false);
  const query = queryFor(config);
  const match = (row: EventResponse) => matchesFeed(row, config);
  const { events, failed, arrived } = useLiveEvents({ limit: config.rows, query, match });

  if (!events) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  // An empty table after a failed load would read as "no events matched".
  if (failed && events.length === 0) {
    return (
      <Center h="100%" p="sm">
        <Text c="dimmed" fz="xs" ta="center">
          Could not load events — new ones will still arrive on the live stream.
        </Text>
      </Center>
    );
  }

  // An empty table reads as "nothing has happened". When the emptiness is the
  // filter's doing, say so and name it — a filter for something nothing produces
  // will never fill up, and no other setting can change that.
  if (events.length === 0) {
    const filters = activeFilters(config);
    return (
      <Center h="100%" p="sm">
        <Text c="dimmed" fz="xs" ta="center">
          {filters.length ? (
            <>
              Nothing matches this widget&apos;s filters.
              <br />
              {filters.join(" · ")}
              <br />
              All of them have to match.
            </>
          ) : (
            "No events yet."
          )}
        </Text>
      </Center>
    );
  }

  return (
    <Box h="100%" style={{ position: "relative" }}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        aria-label="Open fullscreen"
        onClick={() => {
          setEverOpened(true);
          setFullscreen(true);
        }}
        // Above the sticky thead, which Mantine gives z-index 3.
        style={{ position: "absolute", top: 4, right: 4, zIndex: 4 }}
      >
        <IconMaximize size={16} stroke={1.5} />
      </ActionIcon>
      <Box h="100%" p="xs" style={{ overflow: "auto" }}>
        {failed && <StaleNotice />}
        <FeedTable
          columns={config.columns}
          events={events}
          arrived={arrived}
          onColumnWidthChange={(columnId, width) =>
            updateConfig({
              ...config,
              columns: config.columns.map((col) =>
                col.id === columnId ? { ...col, width: Math.round(width) } : col,
              ),
            })
          }
          onColumnFieldChange={(columnId, dataPath) =>
            updateConfig({
              ...config,
              columns: config.columns.map((col) =>
                // The label follows the field unless it was named by hand.
                col.id === columnId ? { ...col, dataPath } : col,
              ),
            })
          }
        />
      </Box>
      {everOpened && (
        <Suspense fallback={null}>
          <FeedFullscreen
            opened={fullscreen}
            config={config}
            onClose={() => setFullscreen(false)}
          />
        </Suspense>
      )}
    </Box>
  );
};

export default FeedView;

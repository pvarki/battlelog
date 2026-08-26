import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Group,
  Loader,
  Table,
  Text,
  UnstyledButton,
} from "@mantine/core";
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
  activeView,
  columnWidth,
  dataValue,
  effectiveColumns,
  effectiveConfig,
  type FeedColumn,
  type FeedConfig,
  type Field,
  labelFor,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  matchesFeed,
  nextViewId,
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
}: {
  columns: FeedColumn[];
  events: EventResponse[];
  /** Row ids that came in on the live stream; those rows wash once on arrival. */
  arrived?: ReadonlySet<string>;
  onRowClick?: (event: EventResponse) => void;
  onColumnWidthChange?: (columnId: string, width: number) => void;
}) => {
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
            <Table.Th key={col.id} style={{ position: "relative" }}>
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
  const view = activeView(config);
  const views = config.views ?? [];
  const { events, failed, arrived } = useLiveEvents({ limit: config.rows, query, match });

  // The chrome stays put whatever the rows are doing. An empty view used to
  // return before the switcher rendered, which left nothing to tap: pick a view
  // with no rows in it and you were stuck there.
  const switcher = view ? (
    <UnstyledButton
      onClick={() => updateConfig({ ...config, activeViewId: nextViewId(config) })}
      disabled={views.length < 2}
      mb={4}
      title={
        views.length < 2
          ? undefined
          : `Tap for the next view: ${views.map((v) => v.label).join(" → ")}`
      }
    >
      <Group gap={4} wrap="nowrap">
        <Text fz="xs" fw={600}>
          {view.label}
        </Text>
        {views.length > 1 && (
          <Text fz="xs" c="dimmed">
            {views.findIndex((v) => v.id === view.id) + 1}/{views.length} ▸
          </Text>
        )}
      </Group>
    </UnstyledButton>
  ) : null;

  const body = () => {
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
        <Text c="dimmed" fz="xs" ta="center" p="sm">
          Could not load events — new ones will still arrive on the live stream.
        </Text>
      );
    }
    // An empty table reads as "nothing has happened". When the emptiness is the
    // filter's doing, say so and name it — a filter for something nothing
    // produces will never fill up, and no other setting can change that.
    if (events.length === 0) {
      const filters = activeFilters(effectiveConfig(config));
      return (
        <Text c="dimmed" fz="xs" ta="center" p="sm">
          {filters.length ? (
            <>
              Nothing matches {view ? `the ${view.label} view` : "this widget's filters"}.
              <br />
              {filters.join(" · ")}
              <br />
              All of them have to match.
            </>
          ) : (
            "No events yet."
          )}
        </Text>
      );
    }
    return (
      <FeedTable
        columns={effectiveColumns(config)}
        events={events}
        arrived={arrived}
        onColumnWidthChange={(columnId, width) =>
          updateConfig({
            ...config,
            // A width belongs to the view's own columns when one is active.
            ...(view
              ? {
                  views: (config.views ?? []).map((v) =>
                    v.id === view.id
                      ? {
                          ...v,
                          columns: v.columns.map((col) =>
                            col.id === columnId ? { ...col, width: Math.round(width) } : col,
                          ),
                        }
                      : v,
                  ),
                }
              : {
                  columns: config.columns.map((col) =>
                    col.id === columnId ? { ...col, width: Math.round(width) } : col,
                  ),
                }),
          })
        }
      />
    );
  };

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
        {failed && events !== null && events.length > 0 && <StaleNotice />}
        {switcher}
        {body()}
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

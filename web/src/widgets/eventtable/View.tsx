import {
  ActionIcon,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Popover,
  Stack,
  Table,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconFilter, IconFilterOff } from "@tabler/icons-react";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import type { EventResponse } from "../../api.ts";
import { Placeholder } from "../../components/Placeholder.tsx";
import { StaleNotice } from "../../components/StaleNotice.tsx";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { ValueCell } from "../../event-binding/cells.tsx";
import { type EventFilter, matchesFeed, queryFor } from "../../event-binding/filter.ts";
import type { BoundState } from "../../event-binding/paths.ts";
import { type EventQuery, queryFilter } from "../../event-binding/query.ts";
import { HEADER_FIELD, useBoundEvents } from "../../event-binding/useBoundEvents.ts";
import { useLiveEvents } from "../../events/live-events.ts";
import { linkedTo } from "../../tak/links.ts";
import { formatShortDateTime } from "../../time.ts";
import { TakSelectionPill } from "../feed/TakSelectionPill.tsx";
import { FilterInput } from "./FilterInput.tsx";
import {
  builtinValue,
  compareCells,
  defaultFilters,
  isFilterActive,
  matchesFilter,
  type SortDir,
} from "./table.ts";
import {
  type ColumnFilter,
  columnLabel,
  type EventTableConfig,
  type TableColumn,
} from "./widget.ts";

const dashboardRoute = getRouteApi("/d/$dashboardId");

const EventTableView = ({ config, onConfigure }: WidgetViewProps<EventTableConfig>) => {
  const filter = queryFilter(config as EventQuery);
  if (!filter) {
    return (
      <Placeholder
        title="No event type yet"
        detail="Choose which events this table lists."
        action={{ label: "Configure", onClick: onConfigure }}
      />
    );
  }
  if (config.columns.length === 0) {
    return (
      <Placeholder
        title="No columns yet"
        detail="Add the event fields this table should show."
        action={{ label: "Add columns", onClick: onConfigure }}
      />
    );
  }
  return <EventTable config={config} filter={filter} />;
};

type Bound = ReturnType<typeof useBoundEvents>;

const cellState = (bound: Bound, event: EventResponse, col: TableColumn): BoundState => {
  if (col.source === "data") return bound.resolve(event.eventId, col.field);
  if (col.source === "header") return bound.resolve(event.eventId, HEADER_FIELD);
  return { state: "ok", value: builtinValue(event, col.source) };
};

const displayText = (col: TableColumn, cell: BoundState): string => {
  if (cell.state !== "ok" || cell.value === null) return "";
  return col.source === "time" ? formatShortDateTime(String(cell.value)) : String(cell.value);
};

const EventTable = ({ config, filter }: { config: EventTableConfig; filter: EventFilter }) => {
  const { tak } = dashboardRoute.useSearch();
  const followed = config.followTakSelection ? tak : undefined;
  const link = followed ? linkedTo(followed) : undefined;
  const { events, failed } = useLiveEvents({
    limit: config.rowLimit,
    query: { ...queryFor(filter), ...link?.query },
    match: (event) => matchesFeed(event, filter) && (!link || link.match(event)),
  });
  const pill = followed && <TakSelectionPill uid={followed} events={events} />;
  const bound = useBoundEvents([], events ?? []);
  // null = the configured default order.
  const [sort, setSort] = useState<{ by: string; dir: SortDir } | null>(null);
  // null = the configured default filters.
  const [sessionFilters, setFilters] = useState<Record<string, ColumnFilter> | null>(null);
  const navigate = dashboardRoute.useNavigate();

  if (!events) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }
  if (events.length === 0) {
    return (
      <Center h="100%" p="sm">
        <Stack gap={4} align="center">
          {pill}
          <Text c="dimmed" fz="xs" ta="center">
            {failed
              ? "Could not load events — new ones will still arrive on the live stream."
              : "No matching events"}
          </Text>
        </Stack>
      </Center>
    );
  }

  const configuredOrder = { by: config.sortBy, dir: config.sortDir };
  const order = (config.allowSorting && sort) || configuredOrder;
  const configuredFilters = defaultFilters(config.columns);
  const filters = (config.allowFiltering && sessionFilters) || configuredFilters;
  const setFilter = (columnId: string, next: ColumnFilter) =>
    setFilters({ ...filters, [columnId]: next });
  const sortColumn = config.columns.find((c) => c.id === order.by);
  const sortKey = (event: EventResponse): BoundState =>
    sortColumn
      ? cellState(bound, event, sortColumn)
      : order.by === "created"
        ? { state: "ok", value: event.eventId }
        : bound.resolve(event.eventId, HEADER_FIELD);

  const rows = events
    .filter((event) =>
      config.columns.every((col) => {
        const cell = cellState(bound, event, col);
        const kind = col.source === "data" ? col.kind : "text";
        return matchesFilter(cell, kind, filters[col.id], displayText(col, cell));
      }),
    )
    .sort((a, b) => compareCells(sortKey(a), sortKey(b), order.dir));

  // asc → desc → back to the configured default.
  const cycleSort = (columnId: string) =>
    setSort((current) =>
      current?.by !== columnId
        ? { by: columnId, dir: "asc" }
        : current.dir === "asc"
          ? { by: columnId, dir: "desc" }
          : null,
    );

  const anyFilter = config.columns.some((c) => isFilterActive(filters[c.id]));

  return (
    <Box h="100%" style={{ position: "relative" }}>
      {config.allowFiltering && anyFilter && (
        <ActionIcon
          variant="light"
          color="accent"
          size="sm"
          aria-label="Clear all filters"
          onClick={() => setFilters({})}
          style={{ position: "absolute", top: 6, right: 6, zIndex: 3 }}
        >
          <IconFilterOff size={14} />
        </ActionIcon>
      )}
      <Box h="100%" p="xs" style={{ overflow: "auto" }}>
        {failed && <StaleNotice />}
        {pill}
        <Table striped highlightOnHover stickyHeader fz="sm" verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              {config.columns.map((col) => (
                <Table.Th key={col.id}>
                  <Group gap={4} wrap="nowrap">
                    <UnstyledButton
                      onClick={() => cycleSort(col.id)}
                      disabled={!config.allowSorting}
                      fz="xs"
                      fw={600}
                      style={config.allowSorting ? undefined : { cursor: "default" }}
                    >
                      <Group gap={2} wrap="nowrap">
                        {columnLabel(col)}
                        {order.by === col.id &&
                          (order.dir === "asc" ? (
                            <IconChevronUp size={12} />
                          ) : (
                            <IconChevronDown size={12} />
                          ))}
                      </Group>
                    </UnstyledButton>
                    {config.allowFiltering && (
                      <ColumnFilterButton
                        column={col}
                        seen={events.map((e) => displayText(col, cellState(bound, e, col)))}
                        filter={filters[col.id] ?? {}}
                        onChange={(next) => setFilter(col.id, next)}
                      />
                    )}
                  </Group>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((event) => (
              <Table.Tr
                key={event.eventId}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  // Editing a cell must not also select the row (menus bubble through portals).
                  if ((e.target as HTMLElement).closest("input,button,label,[role=menuitem]"))
                    return;
                  navigate({
                    search: (prev) => ({ ...prev, event: event.eventId }),
                    replace: true,
                  });
                }}
              >
                {config.columns.map((col) => (
                  <Table.Td key={col.id}>{renderCell(bound, event, col)}</Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {rows.length === 0 && (
          <Text c="dimmed" fz="xs" ta="center" mt="sm">
            No rows match the filters
          </Text>
        )}
      </Box>
    </Box>
  );
};

const renderCell = (bound: Bound, event: EventResponse, col: TableColumn) => {
  const cell = cellState(bound, event, col);
  const editableHeader = col.source === "header" && col.editable;
  if (col.source !== "data" && !editableHeader) {
    const text = displayText(col, cell);
    return (
      <Text fz="sm" c={text ? undefined : "dimmed"}>
        {text || "—"}
      </Text>
    );
  }
  const field = col.source === "header" ? HEADER_FIELD : col.field;
  return (
    <ValueCell
      spec={col.source === "header" ? { ...col, kind: "text" } : col}
      state={cell}
      field={col.source === "header" ? "header" : col.field}
      typeableCount
      onWrite={(value) => bound.write(event.eventId, field, value)}
      onFlush={() => void bound.flush(event.eventId)}
    />
  );
};

const ColumnFilterButton = (props: {
  column: TableColumn;
  seen: string[];
  filter: ColumnFilter;
  onChange: (next: ColumnFilter) => void;
}) => {
  const active = isFilterActive(props.filter);
  return (
    <Popover position="bottom-start" shadow="md" trapFocus>
      <Popover.Target>
        <ActionIcon
          variant={active ? "light" : "subtle"}
          color={active ? "accent" : "gray"}
          size="xs"
          aria-label={`Filter ${columnLabel(props.column)}`}
        >
          <IconFilter size={12} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6} w={200}>
          <FilterInput {...props} />
          {active && (
            <Button size="compact-xs" variant="subtle" onClick={() => props.onChange({})}>
              Clear
            </Button>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

export default EventTableView;

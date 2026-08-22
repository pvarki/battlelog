import { ActionIcon, Badge, Box, Center, Loader, Table, Text } from "@mantine/core";
import { lazy, type ReactNode, Suspense, useState } from "react";
import type { EventResponse } from "../../api.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { useLiveEvents } from "../../live-events.ts";
import { formatShortDateTime } from "../../time.ts";
import {
  dataValue,
  type FeedColumn,
  type FeedConfig,
  type Field,
  labelFor,
  matchesFeed,
  queryFor,
} from "./widget.ts";

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
  onRowClick,
}: {
  columns: FeedColumn[];
  events: EventResponse[];
  onRowClick?: (event: EventResponse) => void;
}) =>
  events.length === 0 ? (
    <Text c="dimmed" fz="sm">
      No matching events.
    </Text>
  ) : (
    <Table fz="xs" striped highlightOnHover verticalSpacing={4}>
      <Table.Thead>
        <Table.Tr>
          {columns.map((col) => (
            <Table.Th key={col.id}>{labelFor(col)}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {events.map((event) => (
          <Table.Tr
            key={event.eventId}
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

const FeedFullscreen = lazy(() => import("./Fullscreen.tsx"));

const FeedView = ({ config }: WidgetViewProps<FeedConfig>) => {
  const [fullscreen, setFullscreen] = useState(false);
  const query = queryFor(config);
  const match = (row: EventResponse) => matchesFeed(row, config);
  const events = useLiveEvents({ limit: config.rows, query, match });

  if (!events) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  return (
    <Box h="100%" p="xs" style={{ overflowY: "auto", position: "relative" }}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        aria-label="Open fullscreen"
        onClick={() => setFullscreen(true)}
        style={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}
      >
        ⛶
      </ActionIcon>
      <FeedTable columns={config.columns} events={events} />
      {fullscreen && (
        <Suspense fallback={null}>
          <FeedFullscreen config={config} onClose={() => setFullscreen(false)} />
        </Suspense>
      )}
    </Box>
  );
};

export default FeedView;

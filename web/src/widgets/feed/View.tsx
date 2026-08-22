import { Badge, Box, Center, Loader, Table, Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { EventResponse } from "../../api.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { useLiveEvents } from "../../live-events.ts";
import { formatShortDateTime } from "../../time.ts";
import { COLUMN_LABEL, type Column, type FeedConfig, matchesFeed, queryFor } from "./widget.ts";

const CELL: Record<Column, (e: EventResponse) => ReactNode> = {
  time: (e) => formatShortDateTime(e.eventTime ?? e.createdAt),
  header: (e) => e.header,
  type: (e) => (e.type ? <Badge variant="light">{e.type}</Badge> : null),
  tags: (e) => e.tags?.join(", "),
  admiralty: (e) => [e.admiraltyReliability, e.admiraltyAccuracy].filter(Boolean).join(""),
  createdBy: (e) => e.createdBy,
};

const FeedView = ({ config }: WidgetViewProps<FeedConfig>) => {
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
    <Box h="100%" p="xs" style={{ overflowY: "auto" }}>
      {events.length === 0 ? (
        <Text c="dimmed" fz="sm">
          No matching events.
        </Text>
      ) : (
        <Table fz="xs" striped highlightOnHover verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              {config.columns.map((col) => (
                <Table.Th key={col}>{COLUMN_LABEL[col]}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {events.map((event) => (
              <Table.Tr key={event.eventId}>
                {config.columns.map((col) => (
                  <Table.Td key={col}>{CELL[col](event)}</Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Box>
  );
};

export default FeedView;

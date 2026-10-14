import { ActionIcon, Anchor, Badge, Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import { IconCurrentLocation, IconExternalLink, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { EventResponse } from "../../api.ts";
import { formatDateTime } from "../../time.ts";
import { type CoordFormat, formatCoord } from "../coords.ts";

type Props = {
  event: EventResponse;
  /** The layers it's drawn on. */
  layerNames: string[];
  coordFormat: CoordFormat;
  onCenter: () => void;
  onClose: () => void;
  /** Extra actions, below the facts. */
  children?: ReactNode;
};

const MAX_DEPTH = 3;

/** Scalar fields of `data` as dot paths, in their stored order. */
export const dataRows = (data: unknown, prefix = "", depth = 0): [string, string][] => {
  if (data === null || typeof data !== "object" || depth > MAX_DEPTH) return [];
  return Object.entries(data).flatMap(([key, value]): [string, string][] => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined || value === "") return [];
    if (typeof value === "object") return dataRows(value, path, depth + 1);
    return [[path, String(value)]];
  });
};

/** A BattleLog event picked on the map: what was logged, read-only. */
export const EventDetails = ({
  event,
  layerNames,
  coordFormat,
  onCenter,
  onClose,
  children,
}: Props) => {
  const rows = dataRows(event.data);
  const admiralty = `${event.admiraltyReliability ?? ""}${event.admiraltyAccuracy ?? ""}`;
  return (
    <Stack gap="sm" h="100%">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ minWidth: 0 }}>
          <Text fz="xs" c="dimmed" tt="uppercase" fw={600}>
            Log entry{event.type ? ` · ${event.type}` : ""}
          </Text>
          <Title order={3} fz="lg" style={{ overflowWrap: "anywhere" }}>
            {event.header}
          </Title>
        </div>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Close details">
          <IconX size={16} />
        </ActionIcon>
      </Group>

      <Group gap="xs">
        {admiralty && (
          <Badge variant="outline" color="gray" title="Admiralty: reliability, credibility">
            {admiralty}
          </Badge>
        )}
        {layerNames.map((name) => (
          <Badge key={name} variant="light" color="gray">
            {name}
          </Badge>
        ))}
      </Group>

      <Group gap="xs" grow>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconCurrentLocation size={14} />}
          onClick={onCenter}
        >
          Centre
        </Button>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconExternalLink size={14} />}
          component="a"
          href={`/events?${new URLSearchParams({ eventId: event.eventId, includeHistory: "true" })}`}
          target="_blank"
        >
          History
        </Button>
      </Group>

      {children}

      <Table fz="xs" verticalSpacing={2}>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td c="dimmed">Time</Table.Td>
            <Table.Td>{formatDateTime(event.eventTime ?? event.createdAt)}</Table.Td>
          </Table.Tr>
          {event.locationPoint && (
            <Table.Tr>
              <Table.Td c="dimmed">Position</Table.Td>
              <Table.Td>
                {formatCoord([event.locationPoint.lng, event.locationPoint.lat], coordFormat)}
              </Table.Td>
            </Table.Tr>
          )}
          {event.location && (
            <Table.Tr>
              <Table.Td c="dimmed">Location</Table.Td>
              <Table.Td>{event.location}</Table.Td>
            </Table.Tr>
          )}
          <Table.Tr>
            <Table.Td c="dimmed">Logged by</Table.Td>
            <Table.Td>{event.createdBy}</Table.Td>
          </Table.Tr>
          {event.tags?.length ? (
            <Table.Tr>
              <Table.Td c="dimmed">Tags</Table.Td>
              <Table.Td>{event.tags.join(", ")}</Table.Td>
            </Table.Tr>
          ) : null}
          {rows.map(([path, value]) => (
            <Table.Tr key={path}>
              <Table.Td c="dimmed">{path}</Table.Td>
              <Table.Td style={{ overflowWrap: "anywhere" }}>{value}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {event.sourceUri && /^https?:\/\//i.test(event.sourceUri) && (
        <Anchor fz="xs" href={event.sourceUri} target="_blank" rel="noreferrer">
          Source
        </Anchor>
      )}
    </Stack>
  );
};

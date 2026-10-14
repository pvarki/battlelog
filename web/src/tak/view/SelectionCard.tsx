import { Anchor, Badge, Button, CloseButton, Group, Paper, Stack, Text } from "@mantine/core";
import { IconCurrentLocation, IconExternalLink, IconNotes } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { EventResponse } from "../../api.ts";
import { formatAge, formatDateTime } from "../../time.ts";
import { type CoordFormat, formatCoord } from "../coords.ts";
import type { TakItem } from "../cot.ts";
import { anchorOf, describeType, hasPosition, labelOf, STATUS_LABEL, statusOf } from "../items.ts";
import type { CardAction } from "../view-options.ts";

type Props = {
  actions: ReadonlySet<CardAction>;
  coordFormat: CoordFormat;
  now: number;
  /** Undefined when it has no position. */
  onCentre: (() => void) | undefined;
  onLog?: () => void;
  openInMapHref: string;
  onClose: () => void;
} & ({ item: TakItem; event?: never } | { event: EventResponse; item?: never });

const Card = ({
  kicker,
  title,
  lines,
  badge,
  children,
  onClose,
}: {
  kicker: string;
  title: string;
  lines: string[];
  badge?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) => (
  <Paper className="tak-view-card" shadow="md" p="sm" withBorder>
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <div style={{ minWidth: 0 }}>
          <Text fz="xs" c="dimmed" tt="uppercase" fw={600} truncate>
            {kicker}
          </Text>
          <Text fw={600} style={{ overflowWrap: "anywhere" }}>
            {title}
          </Text>
        </div>
        <CloseButton size="sm" onClick={onClose} aria-label="Close" />
      </Group>
      {(badge || lines.length > 0) && (
        <Group gap="xs" wrap="wrap">
          {badge}
          {lines.map((line) => (
            <Text key={line} fz="sm" c="dimmed" className="tak-mono">
              {line}
            </Text>
          ))}
        </Group>
      )}
      <Group gap="xs">{children}</Group>
    </Stack>
  </Paper>
);

/** A selected item or log entry in a map view: what it is, and where to go from there. */
export const SelectionCard = ({
  item,
  event,
  actions,
  coordFormat,
  now,
  onCentre,
  onLog,
  openInMapHref,
  onClose,
}: Props) => {
  const buttons = (
    <>
      {actions.has("centre") && onCentre && (
        <Button
          size="compact-sm"
          variant="default"
          leftSection={<IconCurrentLocation size={14} />}
          onClick={onCentre}
        >
          Centre
        </Button>
      )}
      {actions.has("log") && onLog && (
        <Button
          size="compact-sm"
          variant="default"
          leftSection={<IconNotes size={14} />}
          onClick={onLog}
        >
          Log this…
        </Button>
      )}
      {actions.has("openInMap") && (
        <Button
          size="compact-sm"
          variant="default"
          leftSection={<IconExternalLink size={14} />}
          component="a"
          href={openInMapHref}
          target="_blank"
        >
          Open in Map
        </Button>
      )}
    </>
  );

  if (event) {
    const point = event.locationPoint;
    return (
      <Card
        kicker={`Log entry${event.type ? ` · ${event.type}` : ""}`}
        title={event.header}
        lines={[
          formatDateTime(event.eventTime ?? event.createdAt),
          ...(point ? [formatCoord([point.lng, point.lat], coordFormat)] : []),
        ]}
        onClose={onClose}
      >
        {buttons}
        <Anchor
          fz="sm"
          href={`/events?${new URLSearchParams({ eventId: event.eventId, includeHistory: "true" })}`}
          target="_blank"
        >
          History
        </Anchor>
      </Card>
    );
  }

  const status = statusOf(item, now);
  return (
    <Card
      kicker={describeType(item)}
      title={labelOf(item)}
      badge={
        <Badge size="sm" variant="outline" color={status === "online" ? "success" : "warning"}>
          {STATUS_LABEL[status]} · {formatAge(now - item.time)}
        </Badge>
      }
      lines={hasPosition(item) ? [formatCoord(anchorOf(item), coordFormat)] : []}
      onClose={onClose}
    >
      {buttons}
    </Card>
  );
};

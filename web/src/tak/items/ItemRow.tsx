import { Badge, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import type { MouseEvent } from "react";
import { formatAge } from "../../time.ts";
import type { Position, TakItem } from "../cot.ts";
import { bearing, distance, formatDistance } from "../geo.ts";
import {
  anchorOf,
  describeType,
  hasPosition,
  type ItemStatus,
  labelOf,
  STATUS_LABEL,
  statusOf,
  teamColor,
} from "../items.ts";

/** Stale or disconnected; nothing while online. */
export const StatusBadge = ({ status }: { status: ItemStatus }) =>
  status === "online" ? null : (
    <Badge
      size="xs"
      variant="outline"
      tt="none"
      color={status === "offline" ? "gray" : "warning"}
      style={{ flexShrink: 0 }}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );

export const ItemRow = ({
  item,
  selected,
  now,
  from,
  compact,
  onPick,
}: {
  item: TakItem;
  selected: boolean;
  now: number;
  /** Shows the distance and bearing from here. */
  from?: Position;
  /** One line: name, distance and age. */
  compact?: boolean;
  onPick: (event: MouseEvent) => void;
}) => {
  const status = statusOf(item, now);
  const at = from && hasPosition(item) ? anchorOf(item) : undefined;
  if (compact)
    return (
      <UnstyledButton
        className="tak-row"
        data-selected={selected || undefined}
        data-faded={status !== "online" || undefined}
        onClick={onPick}
        aria-current={selected || undefined}
        title={item.team ? `${item.team}${item.role ? ` · ${item.role}` : ""}` : describeType(item)}
      >
        <Group gap="xs" wrap="nowrap">
          <Text fz="sm" fw={500} truncate style={{ flex: 1, minWidth: 0 }}>
            {labelOf(item)}
          </Text>
          <Text fz="xs" c="dimmed" className="tak-mono" style={{ flexShrink: 0 }}>
            {from && at ? `${formatDistance(distance(from, at))} · ` : ""}
            {formatAge(now - item.time)}
          </Text>
          <StatusBadge status={status} />
        </Group>
      </UnstyledButton>
    );
  return (
    <UnstyledButton
      className="tak-row"
      data-selected={selected || undefined}
      data-faded={status !== "online" || undefined}
      onClick={onPick}
      aria-current={selected || undefined}
    >
      <Group gap="xs" wrap="nowrap" justify="space-between">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text fz="sm" fw={500} truncate>
            {labelOf(item)}
          </Text>
          <Text fz="xs" c="dimmed" truncate>
            {item.team ? (
              <>
                <span className="tak-swatch" style={{ background: teamColor(item.team) }} />
                {item.team}
                {item.role ? ` · ${item.role}` : ""}
              </>
            ) : (
              describeType(item)
            )}
          </Text>
        </Stack>
        <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
          {from && at && (
            <Text fz="xs" c="dimmed" className="tak-mono">
              {formatDistance(distance(from, at))} · {Math.round(bearing(from, at)) % 360}°
            </Text>
          )}
          <Group gap={4} wrap="nowrap">
            <Text fz="xs" c="dimmed">
              {formatAge(now - item.time)}
            </Text>
            <StatusBadge status={status} />
          </Group>
        </Stack>
      </Group>
    </UnstyledButton>
  );
};

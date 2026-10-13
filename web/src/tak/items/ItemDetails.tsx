import {
  ActionIcon,
  Badge,
  Button,
  CopyButton,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy, IconCurrentLocation, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { type CoordFormat, formatCoord } from "../coords.ts";
import type { TakItem } from "../cot.ts";
import {
  anchorOf,
  describeType,
  formatAge,
  hasPosition,
  labelOf,
  STATUS_LABEL,
  shortDevice,
  statusOf,
  teamColor,
} from "../items.ts";
import { useNow } from "../use-now.ts";

type Props = {
  item: TakItem;
  coordFormat: CoordFormat;
  /** Names of the missions (Data Sync) that hold this item. */
  missions: string[];
  onCenter: () => void;
  onClose: () => void;
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <Text fz="xs" c="dimmed">
      {label}
    </Text>
    <Text fz="sm" component="div">
      {children}
    </Text>
  </div>
);

const absoluteTime = (ms: number) => new Date(ms).toLocaleString("fi-FI");

/** Everything known about the selected item. Editing actions arrive with the editing slice. */
export const ItemDetails = ({ item, coordFormat, missions, onCenter, onClose }: Props) => {
  const now = useNow(10_000);
  const status = statusOf(item, now);
  const position = anchorOf(item);
  const coordinate = formatCoord(position, coordFormat);
  const secondary = formatCoord(position, coordFormat === "dd" ? "mgrs" : "dd");

  return (
    <Stack gap="sm" h="100%">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ minWidth: 0 }}>
          <Text fz="xs" c="dimmed" tt="uppercase" fw={600}>
            {describeType(item)}
          </Text>
          <Title order={3} fz="lg" style={{ overflowWrap: "anywhere" }}>
            {labelOf(item)}
          </Title>
        </div>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Close details">
          <IconX size={16} />
        </ActionIcon>
      </Group>

      <Group gap="xs">
        <Badge
          variant="outline"
          color={status === "online" ? "success" : status === "stale" ? "warning" : "gray"}
        >
          {STATUS_LABEL[status]}
        </Badge>
        {item.team && (
          <Badge
            variant="outline"
            color="gray"
            leftSection={
              <span className="tak-swatch" style={{ background: teamColor(item.team) }} />
            }
          >
            {item.team}
            {item.role ? ` · ${item.role}` : ""}
          </Badge>
        )}
      </Group>

      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        <Stack gap="sm">
          {hasPosition(item) ? (
            <Field label={item.geometry.type === "Point" ? "Position" : "First point"}>
              <Group gap={4} wrap="nowrap">
                <span className="tak-mono">{coordinate}</span>
                <CopyButton value={coordinate}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied" : "Copy coordinate"} withArrow>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={copy}
                        aria-label="Copy coordinate"
                      >
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
              <Text fz="xs" c="dimmed" className="tak-mono">
                {secondary}
              </Text>
            </Field>
          ) : (
            <Field label="Position">No position fix</Field>
          )}
          {item.hae !== undefined && <Field label="Altitude (HAE)">{Math.round(item.hae)} m</Field>}
          {item.speed !== undefined && item.speed > 0 && (
            <Field label="Speed and course">
              {(item.speed * 3.6).toFixed(0)} km/h
              {item.course !== undefined ? ` · ${Math.round(item.course)}°` : ""}
            </Field>
          )}
          {item.ellipse && (
            <Field label="Size">
              {item.ellipse.major === item.ellipse.minor
                ? `${Math.round(item.ellipse.major)} m radius`
                : `${Math.round(item.ellipse.major)} × ${Math.round(item.ellipse.minor)} m, ${Math.round(item.ellipse.angle)}°`}
            </Field>
          )}
          <Field label="Last update">
            <span title={absoluteTime(item.time)}>{formatAge(now - item.time)} ago</span>
          </Field>
          {item.creator && <Field label="Placed by">{item.creator}</Field>}
          {item.remarks && (
            <Field label="Remarks">
              <span style={{ whiteSpace: "pre-wrap" }}>{item.remarks}</span>
            </Field>
          )}
          {item.battery !== undefined && <Field label="Battery">{item.battery} %</Field>}
          {item.device && <Field label="Device">{shortDevice(item.device)}</Field>}
          {item.sidc && (
            <Field label="Symbol code">
              <span className="tak-mono">{item.sidc}</span>
            </Field>
          )}
          {missions.length > 0 && <Field label="Missions">{missions.join(", ")}</Field>}
          <Field label="UID">
            <span className="tak-mono" style={{ overflowWrap: "anywhere" }}>
              {item.uid}
            </span>
          </Field>
        </Stack>
      </ScrollArea>

      <Button
        variant="default"
        size="xs"
        leftSection={<IconCurrentLocation size={14} />}
        onClick={onCenter}
        disabled={!hasPosition(item)}
      >
        Center on map
      </Button>
    </Stack>
  );
};

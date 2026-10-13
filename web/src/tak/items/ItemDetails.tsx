import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  CopyButton,
  Group,
  Image,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy, IconCurrentLocation, IconPencil, IconX } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { useWrites, type WriteState } from "../commands.ts";
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
  sidcOf,
  statusOf,
  teamColor,
  UNIT_STATUSES,
  type UnitStatus,
  unitStatusOf,
} from "../items.ts";
import { contentLinks } from "../rest.ts";
import { useNow } from "../use-now.ts";
import { AttachPhoto } from "./AttachPhoto.tsx";
import { EditItem } from "./EditItem.tsx";

type Props = {
  item: TakItem;
  coordFormat: CoordFormat;
  /** Why the item can't be changed from here, or undefined when it can. */
  readOnlyReason: string | undefined;
  /** The user's callsign, which uploads are credited to. */
  callsign: string | null | undefined;
  /** Callsigns of TAK users, for sending photos to chosen people. */
  contacts: string[];
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
const WRITE_BADGE: Record<WriteState, { label: string; color: string }> = {
  sending: { label: "Sending…", color: "gray" },
  confirmed: { label: "Saved to TAK", color: "success" },
  unconfirmed: { label: "Not confirmed by TAK", color: "warning" },
  failed: { label: "Not sent to TAK", color: "danger" },
};

export const ItemDetails = ({
  item,
  coordFormat,
  readOnlyReason,
  callsign,
  contacts,
  missions,
  onCenter,
  onClose,
}: Props) => {
  const now = useNow(10_000);
  const [editing, setEditing] = useState<false | { status?: UnitStatus }>(false);
  const write = useWrites().get(item.uid);
  const photos = contentLinks(item.remarks);
  const isUnit = item.type.startsWith("a-") && !item.team;
  const status2525 = isUnit ? unitStatusOf(sidcOf(item) ?? "") : undefined;
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

      {write && (
        <Badge variant="light" color={WRITE_BADGE[write].color} role="status">
          {WRITE_BADGE[write].label}
        </Badge>
      )}

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
          {status2525 && status2525 !== "present" && (
            <Field label="Status">{UNIT_STATUSES[status2525].label}</Field>
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
              <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {item.remarks}
              </span>
            </Field>
          )}
          {photos.length > 0 && (
            <Field label="Photos">
              <Group gap={6}>
                {photos.map((url) => (
                  <Anchor key={url} href={url} target="_blank" rel="noreferrer">
                    <Image
                      src={url}
                      alt={`Photo of ${labelOf(item)}`}
                      w={72}
                      h={72}
                      radius="sm"
                      fit="cover"
                    />
                  </Anchor>
                ))}
              </Group>
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

      {editing ? (
        <EditItem item={item} status={editing.status} onDone={() => setEditing(false)} />
      ) : (
        <Stack gap="xs">
          {isUnit && !readOnlyReason && status2525 !== "destroyed" && (
            <Button
              variant="light"
              color="danger"
              size="xs"
              leftSection={<IconX size={14} />}
              onClick={() => setEditing({ status: "destroyed" })}
            >
              Mark destroyed
            </Button>
          )}
          {callsign && !readOnlyReason && (
            <AttachPhoto
              item={item}
              callsign={callsign}
              contacts={contacts}
              disabled={write === "sending"}
            />
          )}
          <Group gap="xs" grow>
            <Tooltip label={readOnlyReason} disabled={!readOnlyReason} withArrow>
              <Button
                variant="default"
                size="xs"
                leftSection={<IconPencil size={14} />}
                onClick={() => setEditing({})}
                disabled={!!readOnlyReason}
              >
                Edit
              </Button>
            </Tooltip>
            <Button
              variant="default"
              size="xs"
              leftSection={<IconCurrentLocation size={14} />}
              onClick={onCenter}
              disabled={!hasPosition(item)}
            >
              Center on map
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
};

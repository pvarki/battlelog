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
  Switch,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconCurrentLocation,
  IconPencil,
  IconShape,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { useWrites, type WriteState } from "../commands.ts";
import { type RecipientGroup, SendTo } from "../contacts/SendTo.tsx";
import { type CoordFormat, formatCoord } from "../coords.ts";
import type { CotEvent, TakItem } from "../cot.ts";
import { isImage, useAttachments } from "../inbox/import.ts";
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
import { formatDistance } from "../map/layers.ts";
import { AddToMission } from "../missions/AddToMission.tsx";
import type { Mission } from "../missions/missions.ts";
import { contentLinks } from "../rest.ts";
import { sendItem } from "../send.ts";
import { useNow } from "../use-now.ts";
import { AttachPhoto } from "./AttachPhoto.tsx";
import { DeleteItem } from "./DeleteItem.tsx";
import { EditItem } from "./EditItem.tsx";
import { VideoFeed } from "./VideoFeed.tsx";

type Props = {
  item: TakItem;
  coordFormat: CoordFormat;
  /** Why the item can't be changed from here, or undefined when it can. */
  readOnlyReason: string | undefined;
  /** The user's callsign, which uploads are credited to. */
  callsign: string | null | undefined;
  /** TAK users, for sending the item or photos to chosen people. */
  contacts: RecipientGroup[];
  /** Why the item can't be sent to people, or undefined when it can. */
  sendReason: string | undefined;
  onSubmit: (event: CotEvent) => void;
  submitLabel: string;
  /** Starts moving or reshaping the item on the map; undefined when its geometry can't be edited. */
  onEditShape: (() => void) | undefined;
  /** Edits are staged in a plan; photos and sends to people go straight to TAK instead. */
  planActive: boolean;
  /** Whether the map shows where this item has been. */
  tracking: boolean;
  /** Undefined when tracks can't be switched per item (all are shown). */
  onToggleTrack: (() => void) | undefined;
  /** Names of the missions (Data Sync) that hold this item. */
  missions: string[];
  /** Every mission the item could be added to. */
  allMissions: Mission[];
  /** Who this browser writes to TAK as; undefined without a callsign. */
  clientUid: string | undefined;
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
  sendReason,
  onSubmit,
  submitLabel,
  onEditShape,
  planActive,
  tracking,
  onToggleTrack,
  missions,
  allMissions,
  clientUid,
  onCenter,
  onClose,
}: Props) => {
  const now = useNow(10_000);
  const [editing, setEditing] = useState<false | { status?: UnitStatus }>(false);
  const write = useWrites().get(item.uid);
  const received = useAttachments(item.uid);
  const photos = [
    ...contentLinks(item.remarks),
    ...received.filter((f) => isImage(f.name)).map((f) => f.url),
  ];
  const files = received.filter((f) => !isImage(f.name));
  const isUnit = item.type.startsWith("a-") && !item.team;
  const status2525 = isUnit ? unitStatusOf(sidcOf(item) ?? "") : undefined;
  const status = statusOf(item, now);
  const position = anchorOf(item);
  const coordinate = formatCoord(position, coordFormat);
  const secondary = formatCoord(position, coordFormat === "dd" ? "mgrs" : "dd");
  const canMove = item.geometry.type === "Point" && !item.ellipse;

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
          {item.video && (
            <Field label={item.video.alias ? `Video · ${item.video.alias}` : "Video"}>
              <VideoFeed video={item.video} />
            </Field>
          )}
          {item.sensor && (
            <Field label="Sensor">
              {item.sensor.model ? `${item.sensor.model} · ` : ""}
              {Math.round(item.sensor.azimuth)}° · {Math.round(item.sensor.fov)}° wide ·{" "}
              {formatDistance(item.sensor.range)}
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
          {files.length > 0 && (
            <Field label="Files">
              {files.map((file) => (
                <Anchor key={file.url} href={file.url} download={file.name} display="block">
                  {file.name}
                </Anchor>
              ))}
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
        <EditItem
          item={item}
          status={editing.status}
          onSubmit={onSubmit}
          submitLabel={submitLabel}
          onDone={() => setEditing(false)}
        />
      ) : (
        <Stack gap="xs">
          {canMove && (
            <Switch
              size="xs"
              label="Show track"
              description={onToggleTrack ? undefined : "All tracks are shown (Layers)"}
              checked={tracking}
              disabled={!onToggleTrack}
              onChange={onToggleTrack}
            />
          )}
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
          {callsign && !readOnlyReason && !planActive && !item.draft && (
            <AttachPhoto
              item={item}
              callsign={callsign}
              contacts={contacts}
              disabled={write === "sending"}
            />
          )}
          {onEditShape && !readOnlyReason && (
            <Button
              variant="default"
              size="xs"
              leftSection={<IconShape size={14} />}
              onClick={onEditShape}
            >
              {item.geometry.type === "Point" && !item.ellipse ? "Move" : "Edit shape"}
            </Button>
          )}
          {!readOnlyReason && <DeleteItem item={item} onSubmit={onSubmit} />}
          {!item.draft && (
            <SendTo
              what={labelOf(item)}
              contacts={contacts}
              note={planActive ? "Sent now, not staged in the active plan." : undefined}
              disabledReason={sendReason}
              onSend={(callsigns) => sendItem(item, callsigns)}
            />
          )}
          {clientUid && !item.draft && allMissions.length > 0 && (
            <AddToMission item={item} missions={allMissions} clientUid={clientUid} />
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

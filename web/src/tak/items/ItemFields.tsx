import { ActionIcon, Anchor, CopyButton, Group, Image, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { formatAge, formatDateTime } from "../../time.ts";
import { type CoordFormat, formatCoord } from "../coords.ts";
import type { TakItem } from "../cot.ts";
import { formatDistance } from "../geo.ts";
import { isImage, useAttachments } from "../inbox/import.ts";
import { anchorOf, hasPosition, labelOf, shortDevice, UNIT_STATUSES } from "../items.ts";
import { contentLinks } from "../rest.ts";
import { ItemLogEntries } from "./ItemLog.tsx";
import { unitStatusOfItem } from "./item-actions.ts";
import { VideoFeed } from "./VideoFeed.tsx";

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

/** Another item by name, selected on click; just its uid when the picture doesn't hold it. */
const ItemLink = ({
  uid,
  items,
  onSelect,
}: {
  uid: string;
  items: TakItem[];
  onSelect: (uid: string) => void;
}) => {
  const target = items.find((i) => i.uid === uid);
  if (!target) return <span className="tak-mono">{uid}</span>;
  return (
    <Anchor component="button" type="button" fz="sm" onClick={() => onSelect(uid)}>
      {labelOf(target)}
    </Anchor>
  );
};

const absoluteTime = (ms: number) => formatDateTime(ms);

type Props = {
  item: TakItem;
  /** Now, or the moment shown when replaying history. */
  now: number;
  coordFormat: CoordFormat;
  /** The picture, for naming and selecting a drone's operator and its sensor point. */
  items: TakItem[];
  onSelectItem: (uid: string) => void;
  /** Names of the missions (Data Sync) that hold this item. */
  missions: string[];
  /** Opens a BattleLog log entry linked to the item. */
  onOpenEvent: (eventId: string) => void;
  /** Shown after the symbol code, before the log entries. */
  geofence: ReactNode;
};

/** Everything known about the item, as read-only fields. */
export const ItemFields = ({
  item,
  now,
  coordFormat,
  items,
  onSelectItem,
  missions,
  onOpenEvent,
  geofence,
}: Props) => {
  const received = useAttachments(item.uid);
  const photos = [
    ...contentLinks(item.remarks),
    ...received.filter((f) => isImage(f.name)).map((f) => f.url),
  ];
  const files = received.filter((f) => !isImage(f.name));
  const status2525 = unitStatusOfItem(item);
  const position = anchorOf(item);
  const coordinate = formatCoord(position, coordFormat);
  const secondary = formatCoord(position, coordFormat === "dd" ? "mgrs" : "dd");
  const spi = item.sensor || item.vehicle ? items.find((i) => i.sensorUid === item.uid) : undefined;

  return (
    <>
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
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
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
      {item.vehicle && (
        <>
          <SectionHeading>Aircraft</SectionHeading>
          <Field label="State">
            {[
              item.vehicle.make,
              item.vehicle.flying ? "Flying" : "On the ground",
              item.vehicle.battery !== undefined && `${item.vehicle.battery} % battery`,
              item.vehicle.flightTime !== undefined &&
                `${formatAge(item.vehicle.flightTime * 1000)} flown`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Field>
        </>
      )}
      {item.sensor && (
        <Field label={item.vehicle ? "Camera" : "Sensor"}>
          {item.sensor.model ? `${item.sensor.model} · ` : ""}
          {Math.round(item.sensor.azimuth)}° · {Math.round(item.sensor.fov)}° wide ·{" "}
          {formatDistance(item.sensor.range)}
        </Field>
      )}
      {item.vehicle?.operatorUid && (
        <Field label="Operator">
          <ItemLink uid={item.vehicle.operatorUid} items={items} onSelect={onSelectItem} />
        </Field>
      )}
      {spi && (
        <Field label="Looking at">
          <ItemLink uid={spi.uid} items={items} onSelect={onSelectItem} />
        </Field>
      )}
      <Field label="Last update">
        <span title={absoluteTime(item.time)}>{formatAge(now - item.time)} ago</span>
      </Field>
      {item.creator && <Field label="Placed by">{item.creator}</Field>}
      {item.remarks && (
        <Field label="Remarks">
          <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.remarks}</span>
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
      {geofence}
      <ItemLogEntries uid={item.uid} onOpenEvent={onOpenEvent} />
      {missions.length > 0 && <Field label="Data Sync feeds">{missions.join(", ")}</Field>}
      <Field label="UID">
        <span className="tak-mono" style={{ overflowWrap: "anywhere" }}>
          {item.uid}
        </span>
      </Field>
    </>
  );
};

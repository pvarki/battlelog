import { Badge, CloseButton, Group, ScrollArea, Stack, Switch, Text, Title } from "@mantine/core";
import { useState } from "react";
import { useNow } from "../../use-now.ts";
import { useWrites, type WriteState } from "../commands.ts";
import type { RecipientGroup } from "../contacts/SendTo.tsx";
import type { CoordFormat } from "../coords.ts";
import type { CotEvent, TakItem } from "../cot.ts";
import { GeofenceSection } from "../geofence/GeofenceSection.tsx";
import { canBeFence } from "../geofence/geofence.ts";
import {
  describeType,
  labelOf,
  STATUS_LABEL,
  statusOf,
  teamColor,
  type UnitStatus,
} from "../items.ts";
import type { Mission } from "../missions/missions.ts";
import { EditItem } from "./EditItem.tsx";
import { ItemActionBar } from "./ItemActionBar.tsx";
import { ItemFields } from "./ItemFields.tsx";
import { isPointItem, itemActions } from "./item-actions.ts";

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
  /** The drawing tools are still loading, so editing can't start yet. */
  editShapeLoading: boolean;
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
  /** The moment shown when replaying history; undefined when live. */
  replayAt?: number;
  /** Opens a BattleLog log entry linked to the item. */
  onOpenEvent: (eventId: string) => void;
  /** The picture, for naming and selecting a drone's operator and its sensor point. */
  items: TakItem[];
  onSelectItem: (uid: string) => void;
  onCenter: () => void;
  onClose: () => void;
};

const WRITE_BADGE: Record<WriteState, { label: string; color: string }> = {
  sending: { label: "Sending…", color: "gray" },
  confirmed: { label: "Saved to TAK", color: "success" },
  unconfirmed: { label: "Not confirmed by TAK", color: "warning" },
  failed: { label: "Not sent to TAK", color: "danger" },
};

/** Everything known about the selected item, and what can be done to it. */
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
  editShapeLoading,
  planActive,
  tracking,
  onToggleTrack,
  missions,
  allMissions,
  clientUid,
  replayAt,
  onOpenEvent,
  items,
  onSelectItem,
  onCenter,
  onClose,
}: Props) => {
  const liveNow = useNow(10_000);
  const now = replayAt ?? liveNow;
  const [editing, setEditing] = useState<false | { status?: UnitStatus }>(false);
  const write = useWrites().get(item.uid);
  const status = statusOf(item, now);
  const actions = itemActions(item, {
    readOnlyReason,
    callsign,
    planActive,
    clientUid,
    missionCount: allMissions.length,
  });

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
        <CloseButton size="sm" onClick={onClose} aria-label="Close details" />
      </Group>

      <Group gap="xs">
        <Badge
          variant="outline"
          tt="none"
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

      {!editing && (
        <ItemActionBar
          item={item}
          actions={actions}
          write={write}
          callsign={callsign}
          contacts={contacts}
          sendReason={sendReason}
          planActive={planActive}
          allMissions={allMissions}
          clientUid={clientUid}
          replayAt={replayAt}
          onSubmit={onSubmit}
          onCenter={onCenter}
          onEdit={() => setEditing({})}
          onMarkDestroyed={() => setEditing({ status: "destroyed" })}
          onEditShape={onEditShape}
          editShapeLoading={editShapeLoading}
        />
      )}
      {readOnlyReason && !editing && (
        <Text fz="xs" c="dimmed" role="note">
          Read only: {readOnlyReason}
        </Text>
      )}

      <ScrollArea style={{ flex: 1 }} offsetScrollbars="present">
        <Stack gap="sm">
          {isPointItem(item) && !editing && (
            <Switch
              size="xs"
              label="Show track"
              description={onToggleTrack ? undefined : "All tracks are shown (Layers)"}
              checked={tracking}
              disabled={!onToggleTrack}
              onChange={onToggleTrack}
            />
          )}
          <ItemFields
            item={item}
            now={now}
            coordFormat={coordFormat}
            items={items}
            onSelectItem={onSelectItem}
            missions={missions}
            onOpenEvent={onOpenEvent}
            geofence={
              canBeFence(item) &&
              !editing && (
                <GeofenceSection
                  item={item}
                  readOnly={!!readOnlyReason}
                  onSubmit={onSubmit}
                  submitLabel={submitLabel}
                />
              )
            }
          />
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
      ) : null}
    </Stack>
  );
};

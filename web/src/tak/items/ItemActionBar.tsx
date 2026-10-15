import { Button, Group, Menu } from "@mantine/core";
import { useFileDialog } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconChevronDown,
  IconCurrentLocation,
  IconDownload,
  IconFolderPlus,
  IconNotes,
  IconPencil,
  IconPhoto,
  IconShape,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import type { WriteState } from "../commands.ts";
import { type RecipientGroup, SendTo } from "../contacts/SendTo.tsx";
import type { CotEvent, TakItem } from "../cot.ts";
import { hasPosition, labelOf } from "../items.ts";
import { AddToMission } from "../missions/AddToMission.tsx";
import type { Mission } from "../missions/missions.ts";
import { sendItem } from "../send.ts";
import { AttachPhoto } from "./AttachPhoto.tsx";
import { DeleteItem } from "./DeleteItem.tsx";
import { exportTrack, TRACK_FORMATS } from "./ExportTrack.tsx";
import { LogItemDialog } from "./ItemLog.tsx";
import { type ItemActions, isPointItem } from "./item-actions.ts";

type Props = {
  item: TakItem;
  actions: ItemActions;
  /** The item's latest write to TAK, if any. */
  write: WriteState | undefined;
  callsign: string | null | undefined;
  contacts: RecipientGroup[];
  /** Why the item can't be sent to people, or undefined when it can. */
  sendReason: string | undefined;
  planActive: boolean;
  allMissions: Mission[];
  clientUid: string | undefined;
  /** The moment shown when replaying history; undefined when live. */
  replayAt: number | undefined;
  onSubmit: (event: CotEvent) => void;
  onCenter: () => void;
  onEdit: () => void;
  onMarkDestroyed: () => void;
  /** Starts moving or reshaping the item on the map; undefined when its geometry can't be edited. */
  onEditShape: (() => void) | undefined;
  editShapeLoading: boolean;
};

/** The item's buttons and More menu, and the dialogs they open. */
export const ItemActionBar = ({
  item,
  actions,
  write,
  callsign,
  contacts,
  sendReason,
  planActive,
  allMissions,
  clientUid,
  replayAt,
  onSubmit,
  onCenter,
  onEdit,
  onMarkDestroyed,
  onEditShape,
  editShapeLoading,
}: Props) => {
  const [loggingAt, setLoggingAt] = useState<number>();
  const [dialog, setDialog] = useState<"feed" | "delete">();
  const [photo, setPhoto] = useState<File | null>(null);
  const photoDialog = useFileDialog({
    accept: "image/*",
    multiple: false,
    resetOnOpen: true,
    onChange: (files) => setPhoto(files?.[0] ?? null),
  });

  return (
    <>
      <Group gap={6}>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconCurrentLocation size={14} />}
          onClick={onCenter}
          disabled={!hasPosition(item)}
          title="Centre on the map (C)"
        >
          Centre
        </Button>
        {actions.edit && (
          <Button
            variant="default"
            size="xs"
            leftSection={<IconPencil size={14} />}
            onClick={onEdit}
          >
            Edit
          </Button>
        )}
        {onEditShape && actions.edit && (
          <Button
            variant="default"
            size="xs"
            leftSection={<IconShape size={14} />}
            loading={editShapeLoading}
            onClick={onEditShape}
          >
            {isPointItem(item) ? "Move" : "Shape"}
          </Button>
        )}
        {actions.send && (
          <SendTo
            what={labelOf(item)}
            contacts={contacts}
            note={planActive ? "Sent now, not staged in the active plan." : undefined}
            disabledReason={sendReason}
            onSend={(callsigns) => sendItem(item, callsigns)}
          />
        )}
        {actions.more && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button variant="default" size="xs" rightSection={<IconChevronDown size={14} />}>
                More
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {actions.addToFeed && (
                <Menu.Item
                  leftSection={<IconFolderPlus size={14} />}
                  onClick={() => setDialog("feed")}
                >
                  Add to feed…
                </Menu.Item>
              )}
              {actions.attachPhoto && (
                <Menu.Item
                  leftSection={<IconPhoto size={14} />}
                  disabled={write === "sending"}
                  onClick={photoDialog.open}
                >
                  Attach photo…
                </Menu.Item>
              )}
              {actions.log && (
                <Menu.Item
                  leftSection={<IconNotes size={14} />}
                  onClick={() => setLoggingAt(replayAt ?? Date.now())}
                >
                  Log this…
                </Menu.Item>
              )}
              {actions.exportTrack &&
                TRACK_FORMATS.map((format) => (
                  <Menu.Item
                    key={format}
                    leftSection={<IconDownload size={14} />}
                    onClick={() =>
                      void exportTrack(item, format).catch((err: Error) =>
                        notifications.show({ color: "warning", message: err.message }),
                      )
                    }
                  >
                    Track {format.toUpperCase()}
                  </Menu.Item>
                ))}
              {actions.markDestroyed && (
                <Menu.Item
                  color="danger"
                  leftSection={<IconX size={14} />}
                  onClick={onMarkDestroyed}
                >
                  Mark destroyed
                </Menu.Item>
              )}
              {actions.delete && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    color="danger"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => setDialog("delete")}
                  >
                    Delete…
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      {loggingAt !== undefined && (
        <LogItemDialog item={item} at={loggingAt} onClose={() => setLoggingAt(undefined)} />
      )}
      {actions.addToFeed && clientUid && (
        <AddToMission
          item={item}
          missions={allMissions}
          clientUid={clientUid}
          opened={dialog === "feed"}
          onClose={() => setDialog(undefined)}
        />
      )}
      {actions.attachPhoto && callsign && (
        <AttachPhoto
          item={item}
          callsign={callsign}
          contacts={contacts}
          photo={photo}
          onClose={() => setPhoto(null)}
        />
      )}
      <DeleteItem
        item={item}
        onSubmit={onSubmit}
        opened={dialog === "delete"}
        onClose={() => setDialog(undefined)}
      />
    </>
  );
};

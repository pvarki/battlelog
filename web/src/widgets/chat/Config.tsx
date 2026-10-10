// Reads SDK rooms, which mutate in place — see View.tsx.
"use no memo";

import { Button, Group, Paper, SegmentedControl, Select, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { useState } from "react";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { signIn, signOut, useChatStatus, useRoomListChanges } from "./matrix.ts";
import type { ChatConfig } from "./widget.ts";

const RoomSelect = ({
  client,
  value,
  onChange,
}: {
  client: MatrixClient;
  value: string | undefined;
  onChange: (roomId: string | undefined, roomName: string | undefined) => void;
}) => {
  useRoomListChanges(client);
  const rooms = client
    .getRooms()
    .filter((room) => room.getMyMembership() === "join" && !room.isSpaceRoom())
    .map((room) => ({ value: room.roomId, label: room.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <Select
      label="Room"
      description="Rooms you've joined in Matrix"
      placeholder="Pick a room"
      searchable
      data={rooms}
      value={value ?? null}
      onChange={(roomId, option) => onChange(roomId ?? undefined, option?.label)}
    />
  );
};

const inviterOf = (client: MatrixClient, room: Room) => {
  const inviter = room.getMember(client.getSafeUserId())?.events.member?.getSender();
  return inviter && (room.getMember(inviter)?.name ?? inviter);
};

const Invite = ({
  client,
  room,
  onJoined,
}: {
  client: MatrixClient;
  room: Room;
  onJoined: (room: Room) => void;
}) => {
  const [busy, setBusy] = useState<"accept" | "decline">();
  const run = async (kind: "accept" | "decline") => {
    setBusy(kind);
    try {
      if (kind === "accept") {
        await client.joinRoom(room.roomId);
        onJoined(room);
      } else {
        await client.leave(room.roomId);
      }
    } catch (err) {
      notifications.show({
        color: "red",
        title: `Couldn't ${kind} the invite to ${room.name}`,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(undefined);
    }
  };
  const inviter = inviterOf(client, room);
  return (
    <Paper withBorder p="xs">
      <Group gap="xs" wrap="nowrap">
        <Stack gap={0} flex={1} miw={0}>
          <Text fz="sm" truncate>
            {room.name}
          </Text>
          {inviter && (
            <Text fz="xs" c="dimmed" truncate>
              Invited by {inviter}
            </Text>
          )}
        </Stack>
        <Button
          size="compact-xs"
          variant="default"
          loading={busy === "decline"}
          disabled={busy !== undefined}
          onClick={() => void run("decline")}
        >
          Decline
        </Button>
        <Button
          size="compact-xs"
          loading={busy === "accept"}
          disabled={busy !== undefined}
          onClick={() => void run("accept")}
        >
          Accept
        </Button>
      </Group>
    </Paper>
  );
};

const Invites = ({
  client,
  onJoined,
}: {
  client: MatrixClient;
  onJoined: (room: Room) => void;
}) => {
  useRoomListChanges(client);
  const invites = client
    .getRooms()
    .filter((room) => room.getMyMembership() === "invite" && !room.isSpaceRoom());
  if (invites.length === 0) return null;
  return (
    <Stack gap={4}>
      <Text fz="sm" fw={500}>
        Invites
      </Text>
      {invites.map((room) => (
        <Invite key={room.roomId} client={client} room={room} onJoined={onJoined} />
      ))}
    </Stack>
  );
};

const ChatConfigForm = ({ config, onChange }: WidgetConfigProps<ChatConfig>) => {
  const status = useChatStatus();

  const selectRoom = (roomId: string | undefined, roomName: string | undefined) => {
    const client = status.kind === "ready" ? status.client : undefined;
    const previousName = config.roomId && client?.getRoom(config.roomId)?.name;
    const titleIsDefault = !config.title || config.title === previousName;
    const title = titleIsDefault ? roomName?.slice(0, 100) : config.title;
    onChange({ ...config, roomId, title });
  };

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
      <Stack gap="xs">
        <Switch
          label="Show timestamps"
          checked={config.showTimestamps !== false}
          onChange={(e) => onChange({ ...config, showTimestamps: e.currentTarget.checked })}
        />
        <Switch
          label="Show images and audio inline"
          checked={config.showMedia !== false}
          onChange={(e) => onChange({ ...config, showMedia: e.currentTarget.checked })}
        />
        <Switch
          label="Read-only"
          description="For wall displays: no message box or reactions"
          checked={config.readOnly === true}
          onChange={(e) => onChange({ ...config, readOnly: e.currentTarget.checked })}
        />
        <Switch
          label="Mark messages as read"
          description="Off for shared screens, so your unread messages stay unread"
          checked={config.markAsRead ?? config.readOnly !== true}
          onChange={(e) => onChange({ ...config, markAsRead: e.currentTarget.checked })}
        />
        <Switch
          label="Show reactions"
          checked={config.showReactions !== false}
          onChange={(e) => onChange({ ...config, showReactions: e.currentTarget.checked })}
        />
        <Switch
          label={'Show "Seen by"'}
          checked={config.showSeenBy ?? config.readOnly !== true}
          onChange={(e) => onChange({ ...config, showSeenBy: e.currentTarget.checked })}
        />
        <Switch
          label="Compact"
          checked={config.compact === true}
          onChange={(e) => onChange({ ...config, compact: e.currentTarget.checked })}
        />
        <Stack gap={4}>
          <Text fz="sm" fw={500}>
            Text size
          </Text>
          <SegmentedControl
            size="xs"
            data={[
              { value: "sm", label: "S" },
              { value: "md", label: "M" },
              { value: "lg", label: "L" },
              { value: "xl", label: "XL" },
            ]}
            value={config.textSize ?? "md"}
            onChange={(value) =>
              onChange({ ...config, textSize: value as NonNullable<ChatConfig["textSize"]> })
            }
          />
        </Stack>
        <Select
          label="Notify"
          description="Sound, and a desktop notification while BattleLog is in the background"
          data={[
            { value: "off", label: "Off" },
            { value: "mentions", label: "When I'm mentioned" },
            { value: "all", label: "Every message" },
          ]}
          value={config.notify ?? "off"}
          allowDeselect={false}
          onChange={(value) => {
            const notify = (value ?? "off") as NonNullable<ChatConfig["notify"]>;
            if (notify !== "off" && Notification.permission === "default") {
              void Notification.requestPermission();
            }
            onChange({ ...config, notify });
          }}
        />
        <Text fz="xs" c="dimmed">
          Small widgets also hide timestamps and the message box automatically.
        </Text>
      </Stack>
      {status.kind === "ready" ? (
        <>
          <RoomSelect client={status.client} value={config.roomId} onChange={selectRoom} />
          <Invites
            client={status.client}
            onJoined={(room) => {
              if (!config.roomId) selectRoom(room.roomId, room.name);
            }}
          />
          <Stack gap={2} mt="xs">
            <Text fz="sm" fw={500}>
              Matrix account
            </Text>
            <Text fz="xs" c="dimmed">
              Signed in as {status.client.getUserId()}. Shared by every chat widget in this browser.
            </Text>
          </Stack>
          <Button variant="default" size="xs" onClick={() => void signOut()}>
            Sign out of Matrix
          </Button>
        </>
      ) : status.kind === "signed-out" ? (
        <Button size="xs" onClick={signIn}>
          Sign in to Matrix to pick a room
        </Button>
      ) : (
        <Text fz="xs" c="dimmed">
          Matrix isn't connected in this tab, so the room list isn't available.
        </Text>
      )}
    </Stack>
  );
};

export default ChatConfigForm;

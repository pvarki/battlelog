import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { IconUsersPlus } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Placeholder } from "../../components/Placeholder.tsx";
import { formatClockTime } from "../../time.ts";
import { RecipientPicker, recipientGroups } from "../contacts/SendTo.tsx";
import {
  type ChatContact,
  type ChatKind,
  type ChatMessage,
  type ChatRoom,
  chatRooms,
  EVERYONE,
  roomKey,
  roomOf,
} from "./chat.ts";

type Props = {
  messages: ChatMessage[];
  selfUid: string;
  /** Our team, whose room is always offered. */
  team: string;
  /** TAK users who can be messaged. */
  contacts: ChatContact[];
  /** Why sending is unavailable, or undefined when it is. */
  sendReason: string | undefined;
  /** False when the message couldn't leave this browser. */
  onSend: (text: string, room: ChatRoom) => boolean;
  /** The conversation to open on; All Chat Rooms when absent. */
  initialRoom?: ChatRoom;
};

const SECTIONS: Record<ChatKind, string> = {
  all: "Rooms",
  team: "Rooms",
  group: "Groups",
  direct: "Direct",
};

const clock = (time: number) => formatClockTime(time);

/** ATAK GeoChat: All Chat Rooms, team rooms, user groups and direct messages. */
export const ChatDrawer = ({
  messages,
  selfUid,
  team,
  contacts,
  sendReason,
  onSend,
  initialRoom = EVERYONE,
}: Props) => {
  const [chosen, setChosen] = useState(initialRoom);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [groups, setGroups] = useLocalStorage<ChatRoom[]>({
    key: "battlelog.tak.chatGroups",
    defaultValue: [],
  });
  const [readAt, setReadAt] = useLocalStorage<Record<string, number>>({
    key: "battlelog.tak.chatRoomReadAt",
    defaultValue: {},
  });
  const viewport = useRef<HTMLDivElement>(null);

  const listed = chatRooms({ messages, selfUid, team, contacts, groups });
  const key = roomKey(chosen);
  const room = listed.find((r) => roomKey(r) === key) ?? chosen;
  const rooms = listed.some((r) => roomKey(r) === key) ? listed : [...listed, room];
  const byRoom = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    const k = roomKey(roomOf(m, selfUid));
    const inRoom = byRoom.get(k) ?? [];
    inRoom.push(m);
    byRoom.set(k, inRoom);
  }
  const unreadIn = (k: string) =>
    (byRoom.get(k) ?? []).filter((m) => m.time > (readAt[k] ?? 0) && m.senderUid !== selfUid)
      .length;
  const shown = byRoom.get(key) ?? [];
  const roomSendReason =
    sendReason ??
    (room.kind !== "all" && room.members.length === 0
      ? `No one in ${room.name} is on TAK`
      : undefined);

  const newestShown = shown.at(-1);
  useEffect(() => {
    if (newestShown) viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [newestShown]);
  useEffect(() => {
    if (newestShown && newestShown.time > (readAt[key] ?? 0)) {
      setReadAt((read) => ({ ...read, [key]: newestShown.time }));
    }
  }, [newestShown, key, readAt, setReadAt]);

  const send = () => {
    const text = draft.trim();
    if (!text || roomSendReason) return;
    const sent = onSend(text, room);
    setFailed(!sent);
    if (sent) setDraft("");
  };

  const sections = [...new Set(rooms.map((r) => SECTIONS[r.kind]))].map((section) => ({
    group: section,
    items: rooms
      .filter((r) => SECTIONS[r.kind] === section)
      .map((r) => {
        const unread = unreadIn(roomKey(r));
        return { value: roomKey(r), label: unread ? `${r.name} (${unread})` : r.name };
      }),
  }));

  return (
    <Stack gap="xs" h="100%">
      <Group gap="xs" wrap="nowrap">
        <Select
          size="xs"
          style={{ flex: 1 }}
          aria-label="Conversation"
          data={sections}
          value={key}
          onChange={(k) => setChosen(rooms.find((r) => roomKey(r) === k) ?? EVERYONE)}
          allowDeselect={false}
          searchable
        />
        <Tooltip label="New group" withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="New group"
            onClick={() => setCreating(true)}
          >
            <IconUsersPlus size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <NewGroup
        opened={creating}
        contacts={contacts}
        onClose={() => setCreating(false)}
        onCreate={(group) => {
          setGroups((saved) => [...saved, group]);
          setChosen(group);
          setCreating(false);
        }}
      />
      <ScrollArea viewportRef={viewport} style={{ flex: 1 }}>
        <Stack gap={6}>
          {shown.length === 0 && (
            <Box py="md">
              <Placeholder
                title="No messages"
                detail="Nothing in this room in the last eight days."
              />
            </Box>
          )}
          {shown.map((m) => (
            <div
              key={m.id}
              className="tak-chat-message"
              data-own={m.senderUid === selfUid || undefined}
            >
              <Text fz="xs" c="dimmed">
                {m.senderCallsign} · <span className="tak-mono">{clock(m.time)}</span>
              </Text>
              <Text fz="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {m.text}
              </Text>
            </div>
          ))}
        </Stack>
      </ScrollArea>
      {failed && (
        <Text fz="xs" c="danger.4">
          Not sent: not connected to TAK.
        </Text>
      )}
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <Textarea
          size="xs"
          style={{ flex: 1 }}
          autosize
          maxRows={4}
          placeholder={roomSendReason ?? `Message ${room.name}`}
          aria-label="Message"
          disabled={!!roomSendReason}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button size="xs" onClick={send} disabled={!!roomSendReason || !draft.trim()}>
          Send
        </Button>
      </Group>
    </Stack>
  );
};

/** ATAK's user group: a named room only its chosen members receive. */
const NewGroup = ({
  opened,
  contacts,
  onClose,
  onCreate,
}: {
  opened: boolean;
  contacts: ChatContact[];
  onClose: () => void;
  onCreate: (group: ChatRoom) => void;
}) => {
  const [name, setName] = useState("");
  const [callsigns, setCallsigns] = useState<string[]>([]);

  const create = () => {
    onCreate({
      kind: "group",
      id: crypto.randomUUID(),
      name: name.trim(),
      members: contacts
        .filter((c) => callsigns.includes(c.callsign))
        .map(({ uid, callsign }) => ({ uid, callsign })),
      owned: true,
    });
    setName("");
    setCallsigns([]);
  };

  return (
    <Modal opened={opened} onClose={onClose} title="New group" centered>
      <Stack gap="sm">
        <TextInput
          size="xs"
          label="Name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
        />
        <RecipientPicker
          contacts={recipientGroups(contacts)}
          value={callsigns}
          onChange={setCallsigns}
        />
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button size="xs" onClick={create} disabled={!name.trim() || callsigns.length === 0}>
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

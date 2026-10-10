// SDK relations mutate in place — see View.tsx.
"use no memo";

import { ActionIcon, Button, Group, Popover, Tooltip } from "@mantine/core";
import { IconMoodPlus } from "@tabler/icons-react";
import {
  EventType,
  type MatrixClient,
  type MatrixEvent,
  RelationType,
  type Room,
} from "matrix-js-sdk";
import { useState } from "react";

const QUICK_REACTIONS = ["👍", "👎", "✅", "❌", "👀", "❤️", "😂", "😮"];

const reactionsFor = (room: Room, ev: MatrixEvent) => {
  const id = ev.getId();
  if (!id) return [];
  return (
    room.relations
      .getChildEventsForEvent(id, RelationType.Annotation, "m.reaction")
      ?.getSortedAnnotationsByKey() ?? []
  );
};

/** Sends our reaction, or redacts it if we already reacted with that key. */
const toggleReaction = (client: MatrixClient, room: Room, ev: MatrixEvent, key: string) => {
  const sameKey = reactionsFor(room, ev).find(([k]) => k === key)?.[1] ?? [];
  const mine = [...sameKey].find((r) => r.getSender() === client.getUserId() && !r.isRedacted());
  const mineId = mine?.getId();
  // A local echo ("~…") has no server id yet; redacting it or reacting to it throws.
  if (mineId?.startsWith("~") || ev.getId()?.startsWith("~")) return;
  if (mineId) return void client.redactEvent(room.roomId, mineId).catch(() => {});
  void client
    .sendEvent(room.roomId, EventType.Reaction, {
      "m.relates_to": { rel_type: RelationType.Annotation, event_id: ev.getId() ?? "", key },
    })
    .catch(() => {});
};

export const ReactionChips = ({
  client,
  room,
  ev,
  readOnly,
}: {
  client: MatrixClient;
  room: Room;
  ev: MatrixEvent;
  readOnly: boolean;
}) => {
  const me = client.getUserId();
  const reactions = reactionsFor(room, ev)
    .map(([key, events]) => [key, [...events].filter((r) => !r.isRedacted())] as const)
    .filter(([, events]) => events.length > 0);
  if (reactions.length === 0) return null;

  return (
    <Group gap={4} mt={4}>
      {reactions.map(([key, events]) => {
        const names = events.map((r) => room.getMember(r.getSender() ?? "")?.name ?? r.getSender());
        const reacted = events.some((r) => r.getSender() === me);
        return (
          <Tooltip key={key} label={names.join(", ")} withArrow openDelay={300}>
            <Button
              size="compact-xs"
              radius="xl"
              variant={reacted ? "light" : "default"}
              aria-pressed={reacted}
              style={readOnly ? { pointerEvents: "none" } : undefined}
              onClick={() => toggleReaction(client, room, ev, key)}
            >
              {key} {events.length}
            </Button>
          </Tooltip>
        );
      })}
    </Group>
  );
};

export const ReactionPicker = ({
  client,
  room,
  ev,
}: {
  client: MatrixClient;
  room: Room;
  ev: MatrixEvent;
}) => {
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onChange={setOpened} position="top-end" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="default"
          size="sm"
          aria-label="Add reaction"
          data-open={opened || undefined}
          onClick={() => setOpened((o) => !o)}
        >
          <IconMoodPlus size={14} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p={4}>
        <Group gap={2}>
          {QUICK_REACTIONS.map((key) => (
            <ActionIcon
              key={key}
              variant="subtle"
              size="md"
              aria-label={`React ${key}`}
              onClick={() => {
                toggleReaction(client, room, ev, key);
                setOpened(false);
              }}
            >
              {key}
            </ActionIcon>
          ))}
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
};

// SDK events mutate in place — see View.tsx.
"use no memo";

import { ActionIcon, Box, Group, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import {
  Direction,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomEvent,
} from "matrix-js-sdk";
import { useEffect, useReducer, useRef, useState } from "react";
import { Composer, type ComposerTarget } from "./Composer.tsx";
import { Message } from "./Message.tsx";
import { relatesToOf, threadRootId } from "./mentions.ts";
import type { ChatDisplay } from "./widget.ts";

// ponytail: loads at most this many replies; paginate on scroll if threads get longer.
const MAX_REPLIES = 1000;

const loadThread = async (client: MatrixClient, room: Room, rootId: string) => {
  // The mapper, not `new MatrixEvent`, so bundled edits apply to the root.
  const mapper = client.getEventMapper();
  const root =
    room.findEventById(rootId) ?? mapper(await client.fetchRoomEvent(room.roomId, rootId));
  const replies: MatrixEvent[] = [];
  let from: string | undefined;
  do {
    const page = await client.fetchRelations(room.roomId, rootId, "m.thread", null, {
      dir: Direction.Forward,
      from,
      limit: 100,
    });
    replies.push(...page.chunk.map(mapper));
    from = page.next_batch ?? undefined;
  } while (from && replies.length < MAX_REPLIES);
  await Promise.all([root, ...replies].map((ev) => client.decryptEventIfNeeded(ev)));
  return { root, replies };
};

/**
 * One thread, root first. Replies come from the relations API, merged with any
 * that arrive in the live timeline (which the parent re-renders us for).
 */
export const ThreadView = ({
  client,
  room,
  rootId,
  timelineEvents,
  display,
  onClose,
  onFiles,
  replyTo,
}: {
  client: MatrixClient;
  room: Room;
  rootId: string;
  timelineEvents: MatrixEvent[];
  display: ChatDisplay;
  onClose: () => void;
  onFiles: (files: File[]) => void;
  /** Opened via Reply on a message in the room list: start replying to it. */
  replyTo?: MatrixEvent;
}) => {
  const [loaded, setLoaded] = useState<{ root: MatrixEvent; replies: MatrixEvent[] } | null>();
  const [target, setTarget] = useState<ComposerTarget | undefined>(
    replyTo && { kind: "reply", ev: replyTo },
  );
  const viewport = useRef<HTMLDivElement>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // Fetched replies live outside the SDK's timelines, so its edit and
  // redaction bookkeeping can't find them: apply those ourselves.
  useEffect(() => {
    const fetchedById = (id: string | undefined) =>
      id ? loaded?.replies.find((ev) => ev.getId() === id) : undefined;
    const onTimeline = async (ev: MatrixEvent) => {
      if (ev.isRedaction()) {
        const target = fetchedById(ev.event.redacts ?? ev.getContent().redacts);
        if (target && !target.isRedacted()) {
          target.makeRedacted(ev, room);
          rerender();
        }
        return;
      }
      const relation = relatesToOf(ev);
      if (relation?.rel_type !== "m.replace") return;
      const target = fetchedById(relation.event_id);
      if (!target || target.getSender() !== ev.getSender()) return;
      await client.decryptEventIfNeeded(ev);
      target.makeReplaced(ev);
      rerender();
    };
    const listener = (ev: MatrixEvent) => void onTimeline(ev);
    room.on(RoomEvent.Timeline, listener);
    return () => void room.off(RoomEvent.Timeline, listener);
  }, [client, room, loaded]);

  useEffect(() => {
    let live = true;
    loadThread(client, room, rootId).then(
      (thread) => live && setLoaded(thread),
      () => live && setLoaded(null),
    );
    return () => {
      live = false;
    };
  }, [client, room, rootId]);

  const byId = new Map<string, MatrixEvent>();
  for (const ev of loaded?.replies ?? []) byId.set(ev.getId() ?? "", ev);
  for (const ev of timelineEvents) {
    if (threadRootId(relatesToOf(ev)) === rootId) byId.set(ev.getId() ?? ev.getTxnId() ?? "", ev);
  }
  const replies = [...byId.values()].sort((a, b) => a.getTs() - b.getTs());
  const latest = replies.at(-1) ?? loaded?.root;

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the newest reply
  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [replies.length, loaded]);

  return (
    <Stack flex={1} gap={0} miw={0} mih={0}>
      <Group
        gap="xs"
        px="xs"
        py={4}
        wrap="nowrap"
        style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
      >
        <ActionIcon variant="subtle" size="sm" aria-label="Back to room" onClick={onClose}>
          <IconArrowLeft size={14} />
        </ActionIcon>
        <Text fz="sm" fw={600} truncate>
          Thread
        </Text>
        <Text fz="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
        </Text>
      </Group>
      <ScrollArea flex={1} scrollbars="y" type="hover" viewportRef={viewport}>
        <Stack data-chat-list gap={0} px={display.compact ? "xs" : "sm"} pb="sm">
          {loaded === undefined && (
            <Group justify="center" p="sm">
              <Loader size="sm" />
            </Group>
          )}
          {loaded === null && (
            <Text fz="sm" c="dimmed" ta="center" p="sm">
              Couldn't load this thread.
            </Text>
          )}
          {loaded &&
            [loaded.root, ...replies].map((ev, i, all) => (
              <Box key={ev.getId() ?? ev.getTxnId()} data-message data-event-id={ev.getId()}>
                <Message
                  client={client}
                  room={room}
                  ev={ev}
                  startsGroup={i <= 1 || all[i - 1]?.getSender() !== ev.getSender()}
                  display={display}
                  onReply={display.composer ? (ev) => setTarget({ kind: "reply", ev }) : undefined}
                  onEdit={display.composer ? (ev) => setTarget({ kind: "edit", ev }) : undefined}
                  inThread
                />
              </Box>
            ))}
        </Stack>
      </ScrollArea>
      <Box display={display.composer ? undefined : "none"}>
        <Composer
          client={client}
          room={room}
          maxRows={display.composerRows}
          onFiles={onFiles}
          target={target}
          onClearTarget={() => setTarget(undefined)}
          thread={{ rootId, latestEventId: latest?.getId() ?? rootId }}
        />
      </Box>
    </Stack>
  );
};

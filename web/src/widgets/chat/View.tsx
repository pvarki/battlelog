// The SDK mutates events and rooms in place (decryption, redaction, send
// status), so compiler memoization keyed on object identity would render stale.
"use no memo";

import { Box, Button, Divider, Group, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  MatrixEventEvent,
  RelationType,
  type Room,
  RoomEvent,
  RoomMemberEvent,
} from "matrix-js-sdk";
import { type CSSProperties, useEffect, useReducer, useRef, useState } from "react";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { Placeholder } from "../../Placeholder.tsx";
import { formatDate } from "../../time.ts";
import { Composer, type ComposerTarget } from "./Composer.tsx";
import { EncryptionBanner, useUnlock, VerificationDialog } from "./Encryption.tsx";
import { Message } from "./Message.tsx";
import { signIn, takeOverChat, useChatStatus, useRoomListChanges } from "./matrix.ts";
import { sendAttachment } from "./media.ts";
import { relatesToOf, relationFor, threadRootId } from "./mentions.ts";
import { notifyIfNeeded } from "./notify.ts";
import { ThreadView } from "./Thread.tsx";
import { type ChatConfig, chatDisplay } from "./widget.ts";

const GROUP_WINDOW_MS = 5 * 60_000;
const STICK_TO_BOTTOM_PX = 80;

// Relations ride in the clear even on encrypted events, so edits and reactions
// are filtered out before decryption instead of flashing as "Decrypting…".
const isShownMessage = (ev: MatrixEvent) =>
  (ev.getType() === "m.room.message" || ev.getType() === "m.room.encrypted") &&
  !ev.isRelation(RelationType.Replace) &&
  !ev.isRelation(RelationType.Annotation);

const dayOf = (ev: MatrixEvent) => formatDate(new Date(ev.getTs()).toISOString());

const startsGroup = (ev: MatrixEvent, prev: MatrixEvent | undefined) =>
  !prev ||
  prev.getSender() !== ev.getSender() ||
  dayOf(prev) !== dayOf(ev) ||
  ev.getTs() - prev.getTs() > GROUP_WINDOW_MS;

/** Re-renders on anything that changes what the room's live timeline shows. */
const subscribeToRoom = (client: MatrixClient, room: Room, rerender: () => void) => {
  room.on(RoomEvent.Timeline, rerender);
  room.on(RoomEvent.LocalEchoUpdated, rerender);
  room.on(RoomEvent.Redaction, rerender);
  room.on(RoomEvent.Receipt, rerender);
  client.on(MatrixEventEvent.Decrypted, rerender);
  client.on(RoomMemberEvent.Typing, rerender);
  return () => {
    client.off(RoomMemberEvent.Typing, rerender);
    room.off(RoomEvent.Timeline, rerender);
    room.off(RoomEvent.LocalEchoUpdated, rerender);
    room.off(RoomEvent.Redaction, rerender);
    room.off(RoomEvent.Receipt, rerender);
    client.off(MatrixEventEvent.Decrypted, rerender);
  };
};

const LOAD_OLDER_WITHIN_PX = 40;

// Mantine's text sizes are CSS variables; overriding them here scales every
// message, name and input in this widget without touching each component.
// Big text means reading from a distance, so dimmed text gets brighter too.
const textScaleVars = (scale: number) =>
  ({
    ...Object.fromEntries(
      Object.entries({ xs: 0.75, sm: 0.875, md: 1, lg: 1.125, xl: 1.25 }).map(([size, rem]) => [
        `--mantine-font-size-${size}`,
        `calc(${rem * scale}rem * var(--mantine-scale))`,
      ]),
    ),
    ...(scale > 1 ? { "--mantine-color-dimmed": "var(--mantine-color-dark-1)" } : {}),
  }) as CSSProperties;

const RoomChat = ({
  client,
  room,
  config,
}: {
  client: MatrixClient;
  room: Room;
  config: ChatConfig;
}) => {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const size = useElementSize();
  const display = chatDisplay(config, size);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [uploading, setUploading] = useState<{ id: string; name: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [target, setTarget] = useState<ComposerTarget>();
  const [unseen, setUnseen] = useState(0);
  const unlock = useUnlock(client);
  const onUnlock = unlock.trust === "unverified" ? () => unlock.setOpen(true) : undefined;
  const [openThread, setOpenThread] = useState<string>();
  const [threadReplyTo, setThreadReplyTo] = useState<MatrixEvent>();
  const showThread = (rootId: string | undefined, replyTo?: MatrixEvent) => {
    setOpenThread(rootId);
    setThreadReplyTo(replyTo);
  };
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const loadingRef = useRef(false);
  const lastMarked = useRef<string | undefined>(undefined);
  // Captured once: the line stays where the reader left off even after this
  // view marks the room read.
  const [unreadAfter] = useState(
    () => room.getAccountData("m.fully_read")?.getContent<{ event_id?: string }>().event_id,
  );

  useEffect(() => subscribeToRoom(client, room, rerender), [client, room]);

  // Counted per arriving message: one sync can bring several, but renders batch.
  useEffect(() => {
    const onTimeline = (
      ev: MatrixEvent,
      _room: Room | undefined,
      toStart: boolean | undefined,
      _removed: boolean,
      data: { liveEvent?: boolean },
    ) => {
      if (toStart || !data.liveEvent || atBottom.current || !isShownMessage(ev)) return;
      if (ev.getSender() !== client.getUserId()) setUnseen((n) => n + 1);
    };
    room.on(RoomEvent.Timeline, onTimeline);
    return () => void room.off(RoomEvent.Timeline, onTimeline);
  }, [client, room]);

  const notify = config.notify ?? "off";
  useEffect(() => {
    if (notify === "off") return;
    const onTimeline = (
      ev: MatrixEvent,
      _room: Room | undefined,
      toStart: boolean | undefined,
      _removed: boolean,
      data: { liveEvent?: boolean },
    ) => {
      if (!toStart && data.liveEvent) void notifyIfNeeded(client, room, ev, notify);
    };
    room.on(RoomEvent.Timeline, onTimeline);
    return () => void room.off(RoomEvent.Timeline, onTimeline);
  }, [client, room, notify]);

  // Images load and messages decrypt after they render; keep a reader who was
  // at the bottom there as the content grows under them.
  useEffect(() => {
    const el = viewport.current;
    if (!el || !content.current) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTo({ top: el.scrollHeight });
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);

  const timeline = room.getLiveTimeline();
  const allEvents = timeline.getEvents();
  const events = allEvents.filter(isShownMessage);
  const me = client.getUserId();
  const threadReplies = new Map<string, number>();
  for (const ev of events) {
    const root = threadRootId(relatesToOf(ev));
    if (root) threadReplies.set(root, (threadReplies.get(root) ?? 0) + 1);
  }
  // Replying to a thread message belongs in its thread.
  const reply = (ev: MatrixEvent) => {
    const root = threadRootId(relatesToOf(ev));
    if (root) showThread(root, ev);
    else setTarget({ kind: "reply", ev });
  };
  const startEdit = (ev: MatrixEvent) => setTarget({ kind: "edit", ev });
  const typing = room
    .getJoinedMembers()
    .filter((m) => m.typing && m.userId !== me)
    .map((m) => m.name);
  // The read marker can sit on a reaction or edit we don't render: the line goes
  // before the first shown message after it.
  const markerIndex = unreadAfter ? allEvents.findIndex((e) => e.getId() === unreadAfter) : -1;
  const firstUnreadId =
    markerIndex === -1
      ? undefined
      : allEvents
          .slice(markerIndex + 1)
          .find(isShownMessage)
          ?.getId();
  const atStart = !timeline.getPaginationToken(EventTimeline.BACKWARDS);
  const newest = events.at(-1);
  const seenBy = newest
    ? room
        .getUsersReadUpTo(newest)
        .filter((u) => u !== me && u !== newest.getSender())
        .map((u) => room.getMember(u)?.name ?? u)
    : [];

  // Marks read only what the reader can actually see: tab visible and the list
  // scrolled to the newest message. Local echoes ("~…" ids) aren't receiptable.
  const markRead = () => {
    const id = newest?.getId();
    if (
      !display.markAsRead ||
      openThread ||
      !newest ||
      !id ||
      id.startsWith("~") ||
      lastMarked.current === id
    )
      return;
    if (document.visibilityState !== "visible" || !atBottom.current) return;
    lastMarked.current = id;
    void client.setRoomReadMarkers(room.roomId, id, newest).catch(() => {
      lastMarked.current = undefined;
    });
  };

  useEffect(() => {
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  });

  // Follow new messages only while the reader is already at the bottom (or it's
  // their own message) — never yank someone out of the history they're reading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per newest message, not per older page
  useEffect(() => {
    const el = viewport.current;
    if (el && (atBottom.current || newest?.getSender() === me)) {
      el.scrollTo({ top: el.scrollHeight });
      atBottom.current = true;
    }
    markRead();
  }, [newest?.getId() ?? newest?.getTxnId()]);

  const upload = (files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      setUploading((list) => [...list, { id, name: file.name }]);
      const relation = openThread
        ? relationFor(undefined, { rootId: openThread, latestEventId: openThread })
        : {};
      sendAttachment(client, room.roomId, file, relation)
        .catch((err: unknown) =>
          notifications.show({
            color: "red",
            title: `Couldn't send ${file.name}`,
            message: err instanceof Error ? err.message : String(err),
          }),
        )
        .finally(() => setUploading((list) => list.filter((u) => u.id !== id)));
    }
  };

  const scrollToBottom = () => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  };

  const loadOlder = async () => {
    // A ref, not the state: several scroll events land before the re-render.
    if (loadingRef.current) return;
    loadingRef.current = true;
    // Pin the oldest loaded message: after history prepends above it, shift the
    // scroll by however far it moved (live messages appended below don't count).
    const el = viewport.current;
    const anchor = content.current?.querySelector("[data-message]");
    const topBefore = anchor?.getBoundingClientRect().top ?? 0;
    setLoadingOlder(true);
    try {
      await client.scrollback(room, 30);
    } finally {
      setLoadingOlder(false);
      loadingRef.current = false;
    }
    requestAnimationFrame(() => {
      if (el && anchor) el.scrollTop += anchor.getBoundingClientRect().top - topBefore;
    });
  };

  return (
    <Stack
      ref={size.ref}
      h="100%"
      gap={0}
      pos="relative"
      style={textScaleVars(display.textScale)}
      onDragOver={(e) => {
        if (!display.composer || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!display.composer) return;
        e.preventDefault();
        setDragging(false);
        upload([...e.dataTransfer.files]);
      }}
    >
      {dragging && (
        <Stack
          pos="absolute"
          inset={0}
          align="center"
          justify="center"
          bg="rgba(17, 20, 24, 0.85)"
          style={{ zIndex: 3, border: "2px dashed var(--mantine-color-dark-2)", borderRadius: 6 }}
        >
          <Text fw={600}>Drop to send to {room.name}</Text>
        </Stack>
      )}
      <EncryptionBanner client={client} unlock={unlock} short={display.short} />
      <VerificationDialog />
      {openThread && (
        <ThreadView
          key={openThread}
          client={client}
          room={room}
          rootId={openThread}
          timelineEvents={events}
          display={display}
          onClose={() => showThread(undefined)}
          replyTo={threadReplyTo}
          onFiles={upload}
        />
      )}
      <ScrollArea
        display={openThread ? "none" : undefined}
        flex={1}
        scrollbars="y"
        type="hover"
        viewportRef={viewport}
        onScrollPositionChange={() => {
          const el = viewport.current;
          if (!el) return;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
          if (atBottom.current) setUnseen(0);
          if (el.scrollTop < LOAD_OLDER_WITHIN_PX && !atStart) void loadOlder();
          markRead();
        }}
      >
        <Stack
          ref={content}
          data-chat-list
          role="log"
          aria-label={`Messages in ${room.name}`}
          gap={0}
          px={display.compact ? "xs" : "sm"}
          pb="sm"
        >
          {atStart ? (
            <Text fz="xs" c="dimmed" ta="center" pt="sm">
              Start of {room.name}
            </Text>
          ) : (
            <Group justify="center" pt="xs">
              <Button size="compact-xs" variant="subtle" loading={loadingOlder} onClick={loadOlder}>
                Load older messages
              </Button>
            </Group>
          )}
          {events.map((ev, i) => {
            const prev = events[i - 1];
            const newDay = !prev || dayOf(prev) !== dayOf(ev);
            const firstUnread = i > 0 && ev.getId() === firstUnreadId;
            return (
              <Box key={ev.getId() ?? ev.getTxnId()} data-message data-event-id={ev.getId()}>
                {newDay && (
                  <Divider
                    mt="sm"
                    label={dayOf(ev)}
                    labelPosition="center"
                    styles={{ label: { fontSize: "var(--mantine-font-size-xs)" } }}
                  />
                )}
                {firstUnread && (
                  <Divider
                    mt="sm"
                    color="red.6"
                    label="New messages"
                    labelPosition="right"
                    styles={{
                      label: {
                        fontSize: "var(--mantine-font-size-xs)",
                        color: "var(--mantine-color-red-4)",
                      },
                    }}
                  />
                )}
                <Message
                  client={client}
                  room={room}
                  ev={ev}
                  startsGroup={startsGroup(ev, prev)}
                  display={display}
                  onReply={display.composer ? reply : undefined}
                  onEdit={display.composer ? startEdit : undefined}
                  onUnlock={onUnlock}
                  onOpenThread={(rootId) => showThread(rootId)}
                  threadReplies={threadReplies.get(ev.getId() ?? "")}
                />
              </Box>
            );
          })}
          {display.seenBy && seenBy.length > 0 && (
            <Text fz="xs" c="dimmed" ta="right" mt={4} truncate>
              Seen by {seenBy.slice(0, 3).join(", ")}
              {seenBy.length > 3 && ` +${seenBy.length - 3}`}
            </Text>
          )}
        </Stack>
      </ScrollArea>
      {unseen > 0 && !openThread && (
        <Button
          size="compact-xs"
          radius="xl"
          pos="absolute"
          bottom={display.composer ? 64 : 12}
          left="50%"
          style={{ transform: "translateX(-50%)", zIndex: 2 }}
          onClick={scrollToBottom}
        >
          ↓ {unseen} new {unseen === 1 ? "message" : "messages"}
        </Button>
      )}
      {typing.length > 0 && display.composer && (
        <Text fz="xs" c="dimmed" px="sm" truncate>
          {typing.length > 2
            ? "Several people are"
            : `${typing.join(" and ")} ${typing.length === 1 ? "is" : "are"}`}{" "}
          typing…
        </Text>
      )}
      {uploading.length > 0 && (
        <Group gap={6} px="sm" py={4} c="dimmed" wrap="nowrap">
          <Loader size={12} />
          <Text fz="xs" truncate>
            Uploading {uploading.map((u) => u.name).join(", ")}…
          </Text>
        </Group>
      )}
      {/* Hidden, not unmounted, so a resize below the threshold keeps the draft. */}
      <Box display={display.composer && !openThread ? undefined : "none"}>
        <Composer
          client={client}
          room={room}
          maxRows={display.composerRows}
          onFiles={upload}
          target={target}
          onClearTarget={() => setTarget(undefined)}
        />
      </Box>
    </Stack>
  );
};

const ChatView = ({ config, onConfigure }: WidgetViewProps<ChatConfig>) => {
  const status = useChatStatus();

  switch (status.kind) {
    case "signed-out":
      return (
        <Placeholder
          title="Not signed in to Matrix"
          detail="Chat uses your own Matrix account. You'll be sent to sign in and brought back here."
          action={{ label: "Sign in", onClick: signIn }}
        />
      );
    case "starting":
      return <Placeholder title="Connecting to Matrix…" detail="Loading rooms and keys." />;
    case "other-tab":
      return (
        <Placeholder
          title="Chat is open in another tab"
          detail="Matrix runs in one BattleLog tab at a time. Move it here, and the other tab picks it back up when this one closes."
          action={{ label: "Use chat here", onClick: takeOverChat }}
        />
      );
    case "error":
      return (
        <Placeholder
          title="Matrix failed to start"
          detail={status.message}
          action={{ label: "Reload", onClick: () => window.location.reload() }}
        />
      );
  }

  return <ChosenRoom client={status.client} config={config} onConfigure={onConfigure} />;
};

const ChosenRoom = ({
  client,
  config,
  onConfigure,
}: {
  client: MatrixClient;
  config: ChatConfig;
  onConfigure: () => void;
}) => {
  useRoomListChanges(client);
  const { roomId } = config;
  const room = roomId ? client.getRoom(roomId) : null;
  if (!roomId) {
    return (
      <Placeholder
        title="No room selected"
        detail="Pick the Matrix room this widget shows."
        action={{ label: "Choose room", onClick: onConfigure }}
      />
    );
  }
  if (room?.getMyMembership() === "invite") {
    return (
      <Placeholder
        title={`You're invited to ${room.name}`}
        detail="Accept to see this room's chat."
        action={{
          label: "Accept",
          onClick: () =>
            void client.joinRoom(room.roomId).catch((err: unknown) =>
              notifications.show({
                color: "red",
                title: "Couldn't accept the invite",
                message: err instanceof Error ? err.message : String(err),
              }),
            ),
        }}
      />
    );
  }
  // The dashboard is shared: don't offer to change the room for everyone.
  if (room?.getMyMembership() !== "join") {
    return <Placeholder title="No access" detail="You don't have access to this room." />;
  }
  return <RoomChat key={room.roomId} client={client} room={room} config={config} />;
};

export default ChatView;

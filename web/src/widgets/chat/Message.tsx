// SDK events mutate in place (decryption, redaction, send status) — see View.tsx.
"use no memo";

import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Group,
  Loader,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconFile,
  IconPencil,
  IconPhotoOff,
  IconTrash,
} from "@tabler/icons-react";
import { EventStatus, type MatrixClient, MatrixEvent, type Room } from "matrix-js-sdk";
import { useEffect, useRef, useState } from "react";
import { formatClockTime, formatDateTime } from "../../time.ts";
import { type EncryptedFile, fetchAttachment } from "./media.ts";
import {
  displayBody,
  eventPreview,
  mentionsUser,
  relatesToOf,
  replyToId,
  threadRootId,
} from "./mentions.ts";
import { fixOpusGranules } from "./ogg.ts";
import { ReactionChips, ReactionPicker } from "./Reactions.tsx";
import type { ChatDisplay } from "./widget.ts";

type MediaContent = {
  body?: string;
  url?: string;
  file?: EncryptedFile;
  info?: {
    mimetype?: string;
    size?: number;
    duration?: number;
    thumbnail_url?: string;
    thumbnail_file?: EncryptedFile;
    thumbnail_info?: { mimetype?: string };
  };
};

const SENDER_COLORS = ["blue", "teal", "grape", "orange", "cyan", "lime", "pink", "yellow"];
const INLINE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_HEIGHT_PX = 240;
const EDITABLE_MSGTYPES = new Set(["m.text", "m.emote", "m.notice"]);
const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

const wrapStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;

/** Stable per-user name colour, so a sender reads the same everywhere. */
export const senderColor = (userId: string): string => {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `${SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length]}.4`;
};

const formatBytes = (bytes: number | undefined) => {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const Linkified = ({ text }: { text: string }) =>
  text.split(URL_PATTERN).map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one immutable string
      <Anchor key={i} href={part} target="_blank" rel="noopener noreferrer" inherit>
        {part}
      </Anchor>
    ) : (
      part
    ),
  );

// Blob URLs inherit BattleLog's origin, so anything a browser would render as
// a document (HTML, SVG, …) could run script against the Matrix session. Only
// raster images open in a tab; every other attachment is a forced download.
const SAFE_INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const openOrDownload = (blob: Blob, filename: string) => {
  const inline = SAFE_INLINE_TYPES.has(blob.type);
  const url = URL.createObjectURL(
    inline ? blob : new Blob([blob], { type: "application/octet-stream" }),
  );
  if (inline) {
    window.open(url, "_blank", "noopener");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const Attachment = ({ client, content }: { client: MatrixClient; content: MediaContent }) => {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const open = async () => {
    setState("loading");
    try {
      openOrDownload(
        await fetchAttachment(client, content, content.info?.mimetype),
        content.body ?? "attachment",
      );
      setState("idle");
    } catch {
      setState("error");
    }
  };
  return (
    <Button
      variant="default"
      size="compact-sm"
      leftSection={<IconFile size={14} />}
      loading={state === "loading"}
      color={state === "error" ? "red" : undefined}
      onClick={open}
      maw="100%"
      styles={{ label: { overflow: "hidden", textOverflow: "ellipsis" } }}
    >
      {state === "error" ? "Download failed — retry" : (content.body ?? "File")}{" "}
      {formatBytes(content.info?.size)}
    </Button>
  );
};

const ChatImage = ({
  client,
  content,
  maxHeight,
}: {
  client: MatrixClient;
  content: MediaContent;
  maxHeight: number;
}) => {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  const info = content.info ?? {};
  const preview =
    info.thumbnail_file || info.thumbnail_url
      ? {
          url: info.thumbnail_url,
          file: info.thumbnail_file,
          mimetype: info.thumbnail_info?.mimetype,
        }
      : { url: content.url, file: content.file, mimetype: info.mimetype };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the event's media never changes once sent
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    fetchAttachment(client, preview, preview.mimetype)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client]);

  if (failed) {
    return (
      <Group gap={4} c="dimmed">
        <IconPhotoOff size={14} />
        <Text fz="xs">Image couldn't be loaded</Text>
      </Group>
    );
  }
  return (
    <Box
      component="button"
      type="button"
      onClick={() =>
        void fetchAttachment(client, content, info.mimetype)
          .then((blob) => openOrDownload(blob, content.body ?? "image"))
          .catch(() => {})
      }
      p={0}
      bd={0}
      bg="none"
      style={{ cursor: "zoom-in", display: "block", maxWidth: "100%" }}
      aria-label={`Open image ${content.body ?? ""}`}
    >
      {src ? (
        <img
          src={src}
          alt={content.body ?? "Image"}
          style={{ display: "block", maxWidth: "100%", maxHeight, borderRadius: 6 }}
        />
      ) : (
        <Box w={160} h={100} bg="dark.5" style={{ borderRadius: 6 }} />
      )}
    </Box>
  );
};

const formatDuration = (ms: number | undefined) => {
  if (!ms) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const AudioPlayer = ({ client, content }: { client: MatrixClient; content: MediaContent }) => {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  const blob = useRef<Blob>(undefined);
  const repaired = useRef(false);
  const objectUrl = useRef<string>(undefined);
  const mimetype = content.info?.mimetype;
  // Element voice notes are Ogg/Opus, which older Safari can't play: say so
  // and offer the download instead of a player stuck at 0:00.
  const playable = !mimetype || document.createElement("audio").canPlayType(mimetype) !== "";

  const show = (next: Blob) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(next);
    setSrc(objectUrl.current);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by media URL at the call site
  useEffect(() => {
    if (!playable) return;
    let cancelled = false;
    fetchAttachment(client, content, mimetype)
      .then((fetched) => {
        if (cancelled) return;
        blob.current = fetched;
        show(fetched);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, [client]);

  // Firefox rejects Ogg/Opus files whose granule positions start at 0 (a
  // recorder bug); retry once with repaired granules before giving up.
  const retryRepaired = async () => {
    const original = blob.current;
    if (repaired.current || !original) return setFailed(true);
    repaired.current = true;
    const fixed = fixOpusGranules(await original.arrayBuffer());
    if (!fixed) return setFailed(true);
    show(new Blob([fixed], { type: original.type }));
  };

  if (!playable || failed) {
    return (
      <Stack gap={2} align="flex-start">
        <Attachment client={client} content={content} />
        <Text fz="xs" c="dimmed">
          {failed ? "Couldn't play this audio here." : "This browser can't play this audio format."}
        </Text>
      </Stack>
    );
  }
  if (!src) {
    return (
      <Group gap={6} c="dimmed">
        <Loader size={12} />
        <Text fz="xs">Loading audio… {formatDuration(content.info?.duration)}</Text>
      </Group>
    );
  }
  return (
    // biome-ignore lint/a11y/useMediaCaption: user voice/audio messages carry no caption track
    <audio
      controls
      src={src}
      preload="metadata"
      onError={() => void retryRepaired()}
      style={{ maxWidth: "100%", height: 36 }}
    />
  );
};

const MessageBody = ({
  client,
  ev,
  display,
  onUnlock,
}: {
  client: MatrixClient;
  ev: MatrixEvent;
  display: ChatDisplay;
  onUnlock?: () => void;
}) => {
  if (ev.isRedacted()) return <Notice>Message deleted</Notice>;
  if (ev.isDecryptionFailure()) {
    if (!onUnlock) return <Notice>Couldn't decrypt this message</Notice>;
    return (
      <Text fz="sm" c="dimmed" fs="italic">
        Locked on this device.{" "}
        <Anchor component="button" fz="sm" onClick={onUnlock}>
          Unlock
        </Anchor>
      </Text>
    );
  }
  if (ev.getType() === "m.room.encrypted") return <Notice>Decrypting…</Notice>;

  const content = ev.getContent<MediaContent & { msgtype?: string }>();
  const body = displayBody(content, replyToId(relatesToOf(ev)) !== undefined);
  const edited = ev.replacingEventId() ? (
    <Text span fz="xs" c="dimmed">
      {" "}
      (edited)
    </Text>
  ) : null;
  switch (content.msgtype) {
    case "m.image": {
      const tooBig =
        (content.info?.size ?? 0) > INLINE_IMAGE_MAX_BYTES &&
        !content.info?.thumbnail_url &&
        !content.info?.thumbnail_file;
      return tooBig || !display.media ? (
        <Attachment client={client} content={content} />
      ) : (
        <ChatImage
          key={content.file?.url ?? content.url}
          client={client}
          content={content}
          maxHeight={IMAGE_MAX_HEIGHT_PX * display.textScale}
        />
      );
    }
    case "m.audio":
      return display.media ? (
        <AudioPlayer key={content.file?.url ?? content.url} client={client} content={content} />
      ) : (
        <Attachment client={client} content={content} />
      );
    case "m.file":
    case "m.video":
      return <Attachment client={client} content={content} />;
    case "m.notice":
      return (
        <Text fz="sm" c="dimmed" style={wrapStyle}>
          <Linkified text={body} />
          {edited}
        </Text>
      );
    case "m.emote":
      return (
        <Text fz="sm" fs="italic" style={wrapStyle}>
          * {ev.sender?.name ?? ev.getSender()} <Linkified text={body} />
          {edited}
        </Text>
      );
    default:
      return (
        <Text fz="sm" style={wrapStyle}>
          <Linkified text={body} />
          {edited}
        </Text>
      );
  }
};

/** Scrolls this widget's list to a loaded message and flashes it. */
const jumpTo = (from: HTMLElement, eventId: string) => {
  const target = from
    .closest("[data-chat-list]")
    ?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(eventId)}"]`);
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
  target?.animate(
    [{ backgroundColor: "rgba(250, 176, 5, 0.25)" }, { backgroundColor: "transparent" }],
    { duration: 1500 },
  );
};

/** The quoted message above a reply: from the loaded timeline, else fetched once. */
const ReplyQuote = ({
  client,
  room,
  eventId,
}: {
  client: MatrixClient;
  room: Room;
  eventId: string;
}) => {
  const loaded = room.findEventById(eventId);
  const [fetched, setFetched] = useState<MatrixEvent | null>();

  useEffect(() => {
    if (loaded) return;
    let live = true;
    client.fetchRoomEvent(room.roomId, eventId).then(
      async (raw) => {
        const ev = new MatrixEvent(raw);
        await client.decryptEventIfNeeded(ev);
        if (live) setFetched(ev);
      },
      () => live && setFetched(null),
    );
    return () => {
      live = false;
    };
  }, [client, room, eventId, loaded]);

  const original = loaded ?? fetched;
  const sender = original?.getSender() ?? "";
  const text =
    original === null
      ? "Original message not available"
      : !original
        ? "Loading…"
        : original.isRedacted()
          ? "Message deleted"
          : original.isDecryptionFailure() || original.getType() === "m.room.encrypted"
            ? "Encrypted message"
            : eventPreview(original);

  return (
    <UnstyledButton
      display="block"
      w="100%"
      mb={2}
      pl={8}
      style={{
        borderLeft: "2px solid var(--mantine-color-dark-3)",
        cursor: loaded ? "pointer" : "default",
      }}
      onClick={(e) => loaded && jumpTo(e.currentTarget, eventId)}
    >
      <Text fz="xs" c="dimmed" truncate>
        {original && (
          <Text span fz="xs" fw={600} c={senderColor(sender)}>
            {room.getMember(sender)?.name ?? sender}{" "}
          </Text>
        )}
        {text}
      </Text>
    </UnstyledButton>
  );
};

const DeleteButton = ({ onDelete }: { onDelete: () => void }) => {
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onChange={setOpened} position="top-end" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="default"
          size="sm"
          aria-label="Delete"
          data-open={opened || undefined}
          onClick={() => setOpened((o) => !o)}
        >
          <IconTrash size={14} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Group gap="xs" wrap="nowrap">
          <Text fz="sm">Delete for everyone?</Text>
          <Button
            size="compact-xs"
            color="red"
            onClick={() => {
              setOpened(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
};

const ThreadLabel = ({
  room,
  rootId,
  onOpen,
}: {
  room: Room;
  rootId: string;
  onOpen: (rootId: string) => void;
}) => {
  const root = room.findEventById(rootId);
  return (
    <UnstyledButton display="block" w="100%" mb={2} onClick={() => onOpen(rootId)}>
      <Text fz="xs" c="dimmed" truncate>
        in thread
        {root && !root.isRedacted() && root.getType() === "m.room.message"
          ? `: ${eventPreview(root)}`
          : ""}{" "}
        <Text span fz="xs" c="blue.4">
          View
        </Text>
      </Text>
    </UnstyledButton>
  );
};

const Notice = ({ children }: { children: string }) => (
  <Text fz="sm" c="dimmed" fs="italic">
    {children}
  </Text>
);

export const Message = ({
  client,
  room,
  ev,
  startsGroup,
  display,
  onReply,
  onEdit,
  onUnlock,
  onOpenThread,
  threadReplies = 0,
  inThread = false,
}: {
  client: MatrixClient;
  room: Room;
  ev: MatrixEvent;
  /** First message of a run by one sender: shows the name/time header. */
  startsGroup: boolean;
  display: ChatDisplay;
  /** Unset when there's no message box to reply from. */
  onReply?: (ev: MatrixEvent) => void;
  onEdit?: (ev: MatrixEvent) => void;
  /** Set while this device can't decrypt history: offered on undecryptable messages. */
  onUnlock?: () => void;
  /** Opens a thread; unset inside the thread view itself. */
  onOpenThread?: (rootId: string) => void;
  /** Replies to this message seen in the loaded timeline. */
  threadReplies?: number;
  inThread?: boolean;
}) => {
  const sender = ev.getSender() ?? "";
  const iso = new Date(ev.getTs()).toISOString();
  const failed = ev.status === EventStatus.NOT_SENT;
  const sending = ev.status !== null && !failed;
  const me = client.getUserId() ?? "";
  const replyTo = replyToId(relatesToOf(ev));
  const threadRoot = inThread ? undefined : threadRootId(relatesToOf(ev));
  // ponytail: the server's count is a snapshot from when the root loaded; we
  // take the larger of it and replies seen live, so it can lag on long-open views.
  const replyCount = Math.max(
    ev.getServerAggregatedRelation<{ count?: number }>("m.thread")?.count ?? 0,
    threadReplies,
  );
  const mine = sender === me;
  const editable =
    mine && EDITABLE_MSGTYPES.has(ev.getContent<{ msgtype?: string }>().msgtype ?? "");
  const deleteMessage = () =>
    void client.redactEvent(room.roomId, ev.getId() ?? "").catch((err: unknown) =>
      notifications.show({
        color: "red",
        title: "Couldn't delete the message",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  const mentioned = sender !== me && mentionsUser(ev.getContent(), me, room.getMember(me)?.name);

  return (
    <Box
      className="chat-message"
      data-mentioned={mentioned || undefined}
      mt={startsGroup ? (display.compact ? 6 : "sm") : 2}
      px={4}
      miw={0}
      title={formatDateTime(iso)}
    >
      {!display.readOnly && !ev.getId()?.startsWith("~") && ev.getId() && !ev.isRedacted() && (
        <Group
          className="chat-actions"
          gap={4}
          pos="absolute"
          top={-10}
          right={4}
          style={{ zIndex: 1 }}
        >
          {onReply && (
            <ActionIcon variant="default" size="sm" aria-label="Reply" onClick={() => onReply(ev)}>
              <IconArrowBackUp size={14} />
            </ActionIcon>
          )}
          {editable && onEdit && (
            <ActionIcon variant="default" size="sm" aria-label="Edit" onClick={() => onEdit(ev)}>
              <IconPencil size={14} />
            </ActionIcon>
          )}
          {display.reactions && <ReactionPicker client={client} room={room} ev={ev} />}
          {mine && <DeleteButton onDelete={deleteMessage} />}
        </Group>
      )}
      {startsGroup && (
        <Group justify="space-between" wrap="nowrap" gap="xs" mb={2}>
          <Text fz="xs" fw={600} c={senderColor(sender)} truncate miw={0}>
            {room.getMember(sender)?.name ?? sender}
          </Text>
          {display.timestamps && (
            <Text fz="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {formatClockTime(iso)}
            </Text>
          )}
        </Group>
      )}
      <Box opacity={sending ? 0.6 : 1}>
        {threadRoot && onOpenThread && (
          <ThreadLabel room={room} rootId={threadRoot} onOpen={onOpenThread} />
        )}
        {replyTo && !ev.isRedacted() && (
          <ReplyQuote client={client} room={room} eventId={replyTo} />
        )}
        <MessageBody client={client} ev={ev} display={display} onUnlock={onUnlock} />
      </Box>
      {display.reactions && (
        <ReactionChips client={client} room={room} ev={ev} readOnly={display.readOnly} />
      )}
      {!inThread && replyCount > 0 && onOpenThread && (
        <Anchor component="button" fz="xs" mt={2} onClick={() => onOpenThread(ev.getId() ?? "")}>
          {replyCount} {replyCount === 1 ? "reply" : "replies"} · View thread
        </Anchor>
      )}
      {failed && (
        <Group gap={6} mt={2}>
          <Text fz="xs" c="red.4">
            Not sent
          </Text>
          <Anchor component="button" fz="xs" onClick={() => void client.resendEvent(ev, room)}>
            Retry
          </Anchor>
        </Group>
      )}
    </Box>
  );
};

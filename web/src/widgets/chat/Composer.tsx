// Reads SDK room members, which mutate in place — see View.tsx.
"use no memo";

import { ActionIcon, Box, Group, Paper, Text, Textarea, UnstyledButton } from "@mantine/core";
import { IconPaperclip, IconSend, IconX } from "@tabler/icons-react";
import type { MatrixClient, MatrixEvent, Room, RoomMember } from "matrix-js-sdk";
import { useEffect, useRef, useState } from "react";
import {
  buildEditContent,
  buildTextContent,
  displayBody,
  eventPreview,
  type Mention,
  relatesToOf,
  replyToId,
  type ThreadTarget,
} from "./mentions.ts";

/** What the next send does besides posting: reply to, or replace, a message. */
export type ComposerTarget = { kind: "reply" | "edit"; ev: MatrixEvent };

const mentionsOf = (room: Room, ev: MatrixEvent): Mention[] => {
  const ids: unknown = ev.getContent()["m.mentions"]?.user_ids;
  return (Array.isArray(ids) ? ids : [])
    .filter((id): id is string => typeof id === "string")
    .map((userId) => ({ userId, name: room.getMember(userId)?.name ?? userId }));
};

const MAX_SUGGESTIONS = 6;
const TYPING_TIMEOUT_MS = 6000;
const TYPING_RESEND_MS = 4000;

/** `@que` immediately before the caret, if the user is typing a mention. */
const mentionQueryAt = (text: string, caret: number): string | undefined =>
  /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))?.[1];

const matchingMembers = (room: Room, me: string | null, query: string): RoomMember[] => {
  const q = query.toLowerCase();
  return room
    .getJoinedMembers()
    .filter((m) => m.userId !== me)
    .filter((m) => m.name.toLowerCase().includes(q) || m.userId.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS);
};

export const Composer = ({
  client,
  room,
  maxRows,
  onFiles,
  target,
  onClearTarget,
  thread,
}: {
  client: MatrixClient;
  room: Room;
  maxRows: number;
  onFiles: (files: File[]) => void;
  target: ComposerTarget | undefined;
  onClearTarget: () => void;
  /** Set when posting into a thread instead of the room. */
  thread?: ThreadTarget;
}) => {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  const query = mentionQueryAt(draft, caret);
  const suggestions =
    query === undefined || dismissed ? [] : matchingMembers(room, client.getUserId(), query);

  const editing = target?.kind === "edit" ? target.ev : undefined;
  const replyingTo = target?.kind === "reply" ? target.ev : undefined;
  // The draft (and its mentions) from before editing started, restored after.
  const beforeEdit = useRef<{ draft: string; mentions: Mention[] }>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the target changes, not per keystroke
  useEffect(() => {
    if (!target) return;
    if (editing) {
      beforeEdit.current ??= { draft, mentions };
      setDraft(displayBody(editing.getContent(), replyToId(relatesToOf(editing)) !== undefined));
      setMentions(mentionsOf(room, editing));
    }
    input.current?.focus();
  }, [target]);

  const restoreDraft = () => {
    setDraft(beforeEdit.current?.draft ?? "");
    setMentions(beforeEdit.current?.mentions ?? []);
    beforeEdit.current = undefined;
  };

  const clearTarget = () => {
    if (editing) restoreDraft();
    onClearTarget();
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const replyId = replyingTo?.getId();
    const replySender = replyingTo?.getSender();
    const reply = replyId && replySender ? { eventId: replyId, senderId: replySender } : undefined;
    const content = editing
      ? buildEditContent(editing, text, mentions)
      : buildTextContent(text, mentions, reply, thread);
    void client.sendMessage(room.roomId, content);
    void client.sendTyping(room.roomId, false, 0).catch(() => {});
    lastTyping.current = 0;
    if (editing) {
      restoreDraft();
    } else {
      setDraft("");
      setMentions([]);
    }
    onClearTarget();
  };

  // Typing notices at most every few seconds; the server expires them itself.
  const lastTyping = useRef(0);
  const typed = () => {
    if (editing || Date.now() - lastTyping.current < TYPING_RESEND_MS) return;
    lastTyping.current = Date.now();
    void client.sendTyping(room.roomId, true, TYPING_TIMEOUT_MS).catch(() => {});
  };

  const pick = (member: RoomMember) => {
    const before = draft.slice(0, caret).replace(/@[^\s@]*$/, () => `${member.name} `);
    const next = before + draft.slice(caret);
    setDraft(next);
    setMentions((prev) => [...prev, { userId: member.userId, name: member.name }]);
    setHighlighted(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(before.length, before.length);
      setCaret(before.length);
    });
  };

  return (
    <Box pos="relative" style={{ borderTop: "1px solid var(--mantine-color-dark-4)" }}>
      {suggestions.length > 0 && (
        <Paper
          withBorder
          shadow="md"
          pos="absolute"
          bottom="100%"
          left={8}
          right={8}
          mb={4}
          p={4}
          role="listbox"
          aria-label="Mention suggestions"
          style={{ zIndex: 2 }}
        >
          {suggestions.map((member, i) => (
            <UnstyledButton
              key={member.userId}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(member);
              }}
              display="block"
              w="100%"
              px="xs"
              py={4}
              bg={i === highlighted ? "dark.5" : undefined}
              style={{ borderRadius: 4 }}
            >
              <Text fz="sm" truncate>
                {member.name}{" "}
                <Text span fz="xs" c="dimmed">
                  {member.userId}
                </Text>
              </Text>
            </UnstyledButton>
          ))}
        </Paper>
      )}
      {target && (
        <Group gap="xs" px="xs" pt={6} wrap="nowrap">
          <Text fz="xs" c="dimmed" flex={1} miw={0} truncate>
            {editing ? (
              "Editing message"
            ) : (
              <>
                Replying to{" "}
                <Text span fz="xs" fw={600}>
                  {room.getMember(target.ev.getSender() ?? "")?.name ?? target.ev.getSender()}
                </Text>
                : {eventPreview(target.ev)}
              </>
            )}
          </Text>
          <ActionIcon
            size="xs"
            variant="subtle"
            aria-label={editing ? "Cancel edit" : "Cancel reply"}
            onClick={clearTarget}
          >
            <IconX size={12} />
          </ActionIcon>
        </Group>
      )}
      <Group gap="xs" p="xs" wrap="nowrap" align="flex-end">
        <input
          ref={filePicker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            onFiles([...(e.currentTarget.files ?? [])]);
            e.currentTarget.value = "";
          }}
        />
        <ActionIcon
          size="input-sm"
          variant="default"
          aria-label="Attach files"
          onClick={() => filePicker.current?.click()}
        >
          <IconPaperclip size={16} />
        </ActionIcon>
        <Textarea
          ref={input}
          flex={1}
          miw={0}
          autosize
          minRows={1}
          maxRows={maxRows}
          placeholder={thread ? "Reply in thread" : `Message ${room.name}`}
          aria-label={`Message ${room.name}`}
          value={draft}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            if (e.currentTarget.value) typed();
            setCaret(e.currentTarget.selectionStart);
            setHighlighted(0);
            setDismissed(false);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length === 0) return;
            e.preventDefault();
            onFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (suggestions.length > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setHighlighted((h) => (h + step + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const member = suggestions[highlighted];
                if (member) pick(member);
                return;
              }
              if (e.key === "Escape") {
                setDismissed(true);
                return;
              }
            }
            if (e.key === "Escape" && target) {
              clearTarget();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <ActionIcon
          size="input-sm"
          variant="filled"
          aria-label="Send"
          disabled={!draft.trim()}
          onClick={send}
        >
          <IconSend size={16} />
        </ActionIcon>
      </Group>
    </Box>
  );
};

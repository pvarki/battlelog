import { Button, Group, ScrollArea, Select, Stack, Text, Textarea } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { type ChatMessage, type ChatRecipient, conversationOf, EVERYONE } from "./chat.ts";

type Props = {
  messages: ChatMessage[];
  selfUid: string;
  /** TAK users who can be messaged directly. */
  contacts: ChatRecipient[];
  /** Why sending is unavailable, or undefined when it is. */
  sendReason: string | undefined;
  /** False when the message couldn't leave this browser. */
  onSend: (text: string, to: ChatRecipient) => boolean;
  /** The conversation to open on; All Chat Rooms when absent. */
  initialRoom?: ChatRecipient;
};

const clock = (time: number) =>
  new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** ATAK GeoChat: All Chat Rooms and direct messages to TAK users. */
export const ChatDrawer = ({
  messages,
  selfUid,
  contacts,
  sendReason,
  onSend,
  initialRoom = EVERYONE,
}: Props) => {
  const [room, setRoom] = useState(initialRoom);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);

  const rooms = new Map<string, ChatRecipient>([[EVERYONE.uid, EVERYONE]]);
  for (const r of [...messages.map((m) => conversationOf(m, selfUid)), ...contacts, room]) {
    if (!rooms.has(r.uid)) rooms.set(r.uid, r);
  }
  const shown = messages.filter((m) => conversationOf(m, selfUid).uid === room.uid);

  const newestShown = shown.at(-1)?.id;
  useEffect(() => {
    if (newestShown) viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [newestShown]);

  const send = () => {
    const text = draft.trim();
    if (!text || sendReason) return;
    const sent = onSend(text, room);
    setFailed(!sent);
    if (sent) setDraft("");
  };

  return (
    <Stack gap="xs" h="100%">
      <Select
        size="xs"
        aria-label="Conversation"
        data={[...rooms.values()].map((r) => ({ value: r.uid, label: r.callsign }))}
        value={room.uid}
        onChange={(uid) => setRoom((uid && rooms.get(uid)) || EVERYONE)}
        allowDeselect={false}
        searchable
      />
      <ScrollArea viewportRef={viewport} style={{ flex: 1 }}>
        <Stack gap={6}>
          {shown.length === 0 && (
            <Text fz="xs" c="dimmed">
              No messages since this page was opened.
            </Text>
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
        <Text fz="xs" c="red">
          Not sent: not connected to TAK.
        </Text>
      )}
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <Textarea
          size="xs"
          style={{ flex: 1 }}
          autosize
          maxRows={4}
          placeholder={sendReason ?? `Message ${room.callsign}`}
          aria-label="Message"
          disabled={!!sendReason}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button size="xs" onClick={send} disabled={!!sendReason || !draft.trim()}>
          Send
        </Button>
      </Group>
    </Stack>
  );
};

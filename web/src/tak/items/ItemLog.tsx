import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import { CREDIBILITY, RELIABILITY } from "../../admiralty.ts";
import { api } from "../../api.ts";
import { useLiveEvents } from "../../live-events.ts";
import { formatDateTime, formatShortDateTime } from "../../time.ts";
import type { TakItem } from "../cot.ts";
import { anchorOf, hasPosition, labelOf } from "../items.ts";
import { linkedTo, takLinkOf } from "../links.ts";

/** Logs `item` to BattleLog as it was at `at`; talks only to BattleLog, so it works without TAK. */
export const LogItemDialog = ({
  item,
  at,
  onClose,
}: {
  item: TakItem;
  at: number;
  onClose: () => void;
}) => {
  // Taken when the dialog opens: the entry records that moment, not where the item goes next.
  const [snapshot] = useState(() => {
    const [lng, lat] = anchorOf(item);
    return {
      link: takLinkOf(item, at),
      point: hasPosition(item) ? { lat, lng } : undefined,
    };
  });
  const [header, setHeader] = useState(labelOf(item));
  const [type, setType] = useState("tak-observation");
  const [tags, setTags] = useState<string[]>([]);
  const [reliability, setReliability] = useState<(typeof RELIABILITY)[number] | null>(null);
  const [credibility, setCredibility] = useState<(typeof CREDIBILITY)[number] | null>(null);
  const [remarks, setRemarks] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setSending(true);
    setError("");
    try {
      const res = await api.events.$post({
        json: {
          header: header.trim(),
          type: type.trim() || "tak-observation",
          eventTime: snapshot.link.observedAt,
          tags: tags.length ? tags : undefined,
          admiraltyReliability: reliability,
          admiraltyAccuracy: credibility,
          locationPoint: snapshot.point,
          data: { tak: snapshot.link, ...(remarks.trim() ? { remarks: remarks.trim() } : {}) },
        },
      });
      if (!res.ok) {
        setError(`BattleLog refused the entry (${res.status})`);
        return;
      }
      notifications.show({ color: "success", message: `Logged “${header.trim()}”` });
      onClose();
    } catch {
      setError("Could not reach BattleLog");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={`Log ${labelOf(item)}`} centered>
      <Stack
        gap="sm"
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (header.trim()) void submit();
        }}
      >
        <Text fz="xs" c="dimmed">
          As at {formatDateTime(at)}
          {snapshot.point ? ", with its position then" : ", without a position"}
        </Text>
        <TextInput
          label="Header"
          required
          data-autofocus
          value={header}
          onChange={(e) => setHeader(e.currentTarget.value)}
        />
        <TextInput
          label="Event type"
          placeholder="tak-observation"
          value={type}
          onChange={(e) => setType(e.currentTarget.value)}
        />
        <TagsInput label="Tags" value={tags} onChange={setTags} />
        <Group grow>
          <Select
            label="Reliability (A–F)"
            clearable
            data={[...RELIABILITY]}
            value={reliability}
            onChange={(v) => setReliability(v as typeof reliability)}
          />
          <Select
            label="Credibility (1–6)"
            clearable
            data={[...CREDIBILITY]}
            value={credibility}
            onChange={(v) => setCredibility(v as typeof credibility)}
          />
        </Group>
        <Textarea
          label="Remarks"
          autosize
          minRows={2}
          value={remarks}
          onChange={(e) => setRemarks(e.currentTarget.value)}
        />
        {error && (
          <Alert color="danger" p="xs">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={sending} disabled={!header.trim()}>
            Log
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

/** The newest log entries linked to the item `uid`; nothing while there are none. */
export const ItemLogEntries = ({
  uid,
  onOpenEvent,
}: {
  uid: string;
  onOpenEvent: (eventId: string) => void;
}) => {
  const { events, failed } = useLiveEvents({ limit: 20, ...linkedTo(uid) });
  if (!events?.length && !failed) return null;
  return (
    <div>
      <Text fz="xs" c="dimmed">
        Log entries
      </Text>
      {failed && !events?.length && (
        <Text fz="xs" c="dimmed">
          Could not load log entries
        </Text>
      )}
      <Stack gap={2}>
        {events?.map((event) => (
          <UnstyledButton key={event.eventId} onClick={() => onOpenEvent(event.eventId)}>
            <Group gap={6} wrap="nowrap" fz="xs">
              <Text fz="xs" c="dimmed" style={{ flexShrink: 0 }}>
                {formatShortDateTime(event.eventTime ?? event.createdAt)}
              </Text>
              <Text fz="xs" truncate style={{ flex: 1 }}>
                {event.header}
              </Text>
              {event.type && (
                <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>
                  {event.type}
                </Badge>
              )}
            </Group>
          </UnstyledButton>
        ))}
      </Stack>
    </div>
  );
};

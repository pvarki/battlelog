import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Input,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconAlertTriangle, IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { api, type EventResponse } from "../api.ts";
import { isUuid } from "../event-filters.ts";
import { formatShortDateTime } from "../time.ts";

const RESULT_LIMIT = 50;
const PREVIEW_MAX = 200;

const previewData = (data: unknown): string => {
  if (data === null || data === undefined) return "";
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return text.slice(0, PREVIEW_MAX);
};

const shortId = (id: string) => id.slice(0, 8);

type Linked =
  | { state: "loading" }
  | { state: "found"; row: EventResponse }
  | { state: "missing" }
  | { state: "error" };

const useLinkedEvent = (eventId: string | undefined): Linked => {
  const [linked, setLinked] = useState<Linked>({ state: "loading" });
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLinked({ state: "loading" });
    api.events[":eventId"]
      .$get({ param: { eventId } })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) return setLinked({ state: "missing" });
        if (res.status !== 200) return setLinked({ state: "error" });
        const row = await res.json();
        if (!cancelled) setLinked({ state: "found", row });
      })
      .catch(() => !cancelled && setLinked({ state: "error" }));
    return () => {
      cancelled = true;
    };
  }, [eventId]);
  return linked;
};

const useEventSearch = (opened: boolean, search: string, eventType: string | undefined) => {
  const [rows, setRows] = useState<EventResponse[] | undefined>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setFailed(false);
    api.events
      .$get({
        query: {
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(eventType ? { types: eventType } : {}),
          limit: RESULT_LIMIT,
        },
      })
      .then(async (res) => {
        if (!res.ok) throw new Error(`search failed (${res.status})`);
        const found = await res.json();
        if (!cancelled) setRows(found);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [opened, search, eventType]);
  return { rows, failed };
};

const EventSummary = ({ row }: { row: EventResponse }) => (
  <Box mih={0} style={{ flex: 1 }}>
    <Group gap="xs" wrap="nowrap">
      <Text fz="sm" fw={500} truncate>
        {row.header}
      </Text>
      {row.type && (
        <Badge size="xs" variant="light" color="gray">
          {row.type}
        </Badge>
      )}
    </Group>
    <Text fz="xs" c="dimmed" truncate>
      {row.createdBy} · updated {formatShortDateTime(row.createdAt)} · {shortId(row.eventId)}
    </Text>
  </Box>
);

const PickerDialog = ({
  opened,
  onClose,
  onPick,
  eventType,
}: {
  opened: boolean;
  onClose: () => void;
  onPick: (eventId: string) => void;
  eventType: string | undefined;
}) => {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [pasted, setPasted] = useState("");
  const { rows, failed } = useEventSearch(opened, debouncedSearch, eventType);
  const pastedId = pasted.trim();

  return (
    <Modal opened={opened} onClose={onClose} title="Link an event" size="lg">
      <Stack>
        <TextInput
          data-autofocus
          placeholder="Search header and text"
          leftSection={<IconSearch size={16} stroke={1.5} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        {eventType && (
          <Text fz="xs" c="dimmed">
            Only <b>{eventType}</b> events — another type's data wouldn't fit this widget.
          </Text>
        )}
        <Box mah="50vh" style={{ overflowY: "auto" }}>
          <Stack gap="xs">
            {failed && (
              <Text fz="sm" c="red.4" role="status">
                Couldn't load events.
              </Text>
            )}
            {!rows && !failed && <Loader size="sm" />}
            {rows?.map((row) => (
              <UnstyledButton key={row.eventId} onClick={() => onPick(row.eventId)}>
                <Paper withBorder p="xs">
                  <EventSummary row={row} />
                  {previewData(row.data) && (
                    <Text fz="xs" c="dimmed" ff="monospace" truncate>
                      {previewData(row.data)}
                    </Text>
                  )}
                </Paper>
              </UnstyledButton>
            ))}
            {rows?.length === 0 && (
              <Text fz="sm" c="dimmed">
                No matching events.
              </Text>
            )}
          </Stack>
        </Box>
        <Group align="flex-end" wrap="nowrap">
          <TextInput
            label="Or paste an event id"
            size="xs"
            style={{ flex: 1 }}
            value={pasted}
            error={pastedId && !isUuid(pastedId) ? "Not a valid event id" : undefined}
            onChange={(e) => setPasted(e.currentTarget.value)}
          />
          <Button size="xs" disabled={!isUuid(pastedId)} onClick={() => onPick(pastedId)}>
            Use id
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

/** Links a config to an event chain by its stable eventId; unset means none yet. */
export const EventPicker = ({
  value,
  onChange,
  eventType,
  label = "Event",
  description,
  emptyText = "None yet — a new event is created on first edit.",
}: {
  value: string | undefined;
  onChange: (eventId: string | undefined) => void;
  /** Locks the search to this type: a widget can't read another type's data shape. */
  eventType?: string;
  label?: string;
  description?: string;
  emptyText?: string;
}) => {
  const [opened, setOpened] = useState(false);
  const linked = useLinkedEvent(value);

  return (
    <Input.Wrapper label={label} description={description}>
      <Paper withBorder p="xs" mt={4}>
        <Stack gap="xs">
          {!value ? (
            <Text fz="sm" c="dimmed">
              {emptyText}
            </Text>
          ) : linked.state === "found" ? (
            <EventSummary row={linked.row} />
          ) : linked.state === "loading" ? (
            <Loader size="xs" />
          ) : (
            <Alert
              p="xs"
              color="yellow"
              icon={<IconAlertTriangle size={16} stroke={1.5} />}
              title={linked.state === "missing" ? "Event not found" : "Couldn't load event"}
            >
              <Text fz="xs" ff="monospace">
                {value}
              </Text>
            </Alert>
          )}
          <Group gap="xs">
            <Button size="compact-xs" variant="light" onClick={() => setOpened(true)}>
              Change…
            </Button>
            {value && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => onChange(undefined)}
              >
                {eventType ? "Start fresh" : "Clear"}
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>
      <PickerDialog
        opened={opened}
        onClose={() => setOpened(false)}
        eventType={eventType}
        onPick={(eventId) => {
          onChange(eventId);
          setOpened(false);
        }}
      />
    </Input.Wrapper>
  );
};

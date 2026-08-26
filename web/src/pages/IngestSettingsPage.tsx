import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useEffectEvent, useState } from "react";
import { ingestApi } from "../api.ts";
import { Placeholder } from "../Placeholder.tsx";
import { formatDateTime } from "../time.ts";

/**
 * What the feed ingests, editable at runtime. Admin-only: the API rejects
 * everyone else, and this page shows what it was told rather than guessing.
 *
 * The status badge is the point of the whole screen. "Nothing is arriving" has
 * several very different causes — TAK refusing our certificate, a room being
 * encrypted, nothing selected — and an operator should not have to read
 * container logs to tell them apart.
 */

type IngestSource = {
  id: string;
  kind: "tak" | "matrix";
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  status: {
    status: "disabled" | "connecting" | "connected" | "error" | "not-joined" | "encrypted";
    lastError?: string;
    lastEventAt?: string;
    eventCount: number;
  };
};

type MatrixRoom = { roomId: string; name?: string; alias?: string };

const STATUS_LOOK: Record<IngestSource["status"]["status"], { c: string; label: string }> = {
  connected: { c: "teal", label: "Live" },
  connecting: { c: "yellow", label: "Connecting" },
  error: { c: "red", label: "Error" },
  "not-joined": { c: "orange", label: "Bot not in room" },
  encrypted: { c: "orange", label: "Encrypted, unreadable" },
  disabled: { c: "gray", label: "Off" },
};

const TAK_FIELDS = [
  {
    key: "cotTypes",
    label: "CoT type",
    help: 'e.g. "^a-f-" for friendly tracks, "^b-t-f" for chat, "^a-[fh]-" for either.',
  },
  { key: "chatRooms", label: "GeoChat room", help: 'e.g. "^RECON$" for exactly that room.' },
  { key: "senderCallsigns", label: "Sender callsign", help: 'e.g. "^(ALPHA|BRAVO)-\\d+$".' },
  { key: "destCallsigns", label: "Recipient callsign", help: "For chat addressed to someone." },
  {
    key: "detailContains",
    label: "Detail matches",
    help: 'Matched against the raw CoT <detail> XML, e.g. role="HQ". The only way to select on things TAK has no server-side concept of — read a real event\'s detail to find what to match.',
  },
] as const;

const StatusBadge = ({ status }: { status: IngestSource["status"] }) => {
  const look = STATUS_LOOK[status.status];
  const detail = [
    status.lastError,
    status.lastEventAt ? `Last event ${formatDateTime(status.lastEventAt)}` : undefined,
  ]
    .filter(Boolean)
    .join(" — ");
  const badge = (
    <Badge color={look.c} variant="light">
      {look.label} · {status.eventCount}
    </Badge>
  );
  return detail ? (
    <Tooltip label={detail} multiline w={320}>
      {badge}
    </Tooltip>
  ) : (
    badge
  );
};

const listOf = (config: Record<string, unknown>, key: string): string[] => {
  const value = config[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

export const IngestSettingsPage = () => {
  const [sources, setSources] = useState<IngestSource[]>([]);
  const [rooms, setRooms] = useState<MatrixRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [adding, setAdding] = useState<"tak" | "matrix" | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const [botUserId, setBotUserId] = useState<string | null>(null);

  // useEffectEvent: reload is recreated every render but the polling effect must
  // not restart because of it.
  const reload = useEffectEvent(async () => {
    const res = await ingestApi.ingest.sources.$get();
    if (res.status === 401 || res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    if (!res.ok) throw new Error(`Failed to load ingest sources (${res.status})`);
    setSources((await res.json()) as IngestSource[]);
    // Who to invite, for the not-joined case.
    const status = await ingestApi.ingest.status.$get();
    if (status.ok)
      setBotUserId(((await status.json()) as { matrixBotUserId: string | null }).matrixBotUserId);
    setLoading(false);
  });

  useEffect(() => {
    void reload().catch((err: unknown) => {
      notifications.show({ color: "red", message: String(err) });
      setLoading(false);
    });
    // Status is live process state, so it only changes by polling. Slow on
    // purpose: this is a settings screen, not a monitor.
    const timer = setInterval(() => void reload().catch(() => {}), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Only fetched when the Matrix form opens: it hits the homeserver.
  useEffect(() => {
    if (adding !== "matrix") return;
    void (async () => {
      const res = await ingestApi.ingest.matrix.rooms.$get();
      if (res.ok) setRooms((await res.json()) as MatrixRoom[]);
      else {
        notifications.show({
          color: "yellow",
          message: "Could not list rooms from the homeserver — enter a room ID by hand.",
        });
      }
    })();
  }, [adding]);

  const patch = async (source: IngestSource, body: Record<string, unknown>) => {
    const res = await ingestApi.ingest.sources[":sourceId"].$patch({
      param: { sourceId: source.id },
      // The generated types describe a discriminated config union; this page
      // edits one key at a time, which the union cannot express.
      json: body as never,
    });
    if (!res.ok) {
      notifications.show({ color: "red", message: `Could not save (${res.status})` });
      return;
    }
    await reload();
  };

  const remove = async (source: IngestSource) => {
    const res = await ingestApi.ingest.sources[":sourceId"].$delete({
      param: { sourceId: source.id },
    });
    if (!res.ok) {
      notifications.show({ color: "red", message: `Could not delete (${res.status})` });
      return;
    }
    await reload();
  };

  if (loading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }

  if (forbidden) {
    return (
      <Placeholder
        title="Admins only"
        detail="Changing what the feed ingests needs Deploy App admin rights."
      />
    );
  }

  return (
    <Stack p="md" gap="lg" maw={900}>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={3}>Ingest</Title>
          <Text c="dimmed" fz="sm">
            What arrives in the feed from TAK and Matrix. Changes apply within seconds — no restart.
          </Text>
        </div>
        <Group gap="xs">
          <Button
            leftSection={<IconPlus size={16} />}
            variant="light"
            onClick={() => setAdding("tak")}
          >
            TAK filter
          </Button>
          <Button
            leftSection={<IconPlus size={16} />}
            variant="light"
            onClick={() => setAdding("matrix")}
          >
            Matrix room
          </Button>
        </Group>
      </Group>

      {sources.length === 0 && (
        <Alert color="gray" title="Nothing is being ingested">
          Add a TAK filter or a Matrix room. Until then the feed only contains what people and the
          API put in it directly.
        </Alert>
      )}

      <Accordion variant="separated" multiple value={opened} onChange={setOpened}>
        {sources.map((source) => (
          <Accordion.Item key={source.id} value={source.id}>
            <Group wrap="nowrap" gap="xs" pr="sm">
              {/* Outside the control: toggling or deleting a setup should not
                  expand it, and a switch inside a button is not clickable. */}
              <Switch
                ml="sm"
                checked={source.enabled}
                onChange={(e) => void patch(source, { enabled: e.currentTarget.checked })}
                aria-label={`Enable ${source.name}`}
              />
              <Accordion.Control>
                <Group justify="space-between" wrap="nowrap" pr="sm">
                  <div>
                    <Text fw={600}>{source.name}</Text>
                    <Text c="dimmed" fz="xs" tt="uppercase">
                      {source.kind}
                    </Text>
                  </div>
                  <StatusBadge status={source.status} />
                </Group>
              </Accordion.Control>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Delete ${source.name}`}
                onClick={() => void remove(source)}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
            <Accordion.Panel>
              {source.status.status === "not-joined" && (
                <Alert
                  color="orange"
                  icon={<IconAlertTriangle size={16} />}
                  mb="sm"
                  title="The bot is not in this room"
                >
                  Nothing from it reaches the feed until it is. A room the deployment Space makes
                  joinable is joined automatically within a few seconds; an invite-only room needs a
                  member to invite <strong>{botUserId ?? "the ingest bot"}</strong> — the invite is
                  then accepted on its own, no restart needed.
                </Alert>
              )}

              {source.status.status === "encrypted" && (
                <Alert
                  color="orange"
                  icon={<IconAlertTriangle size={16} />}
                  mb="sm"
                  title="This room is end-to-end encrypted"
                >
                  Its messages cannot be read, so nothing from it reaches the feed. Only a room
                  created without encryption can be ingested.
                </Alert>
              )}

              {source.kind === "tak" && (
                <Stack gap="sm">
                  {TAK_FIELDS.every((field) => listOf(source.config, field.key).length === 0) && (
                    <Alert color="yellow" variant="light">
                      No filters set, so this takes <strong>every</strong> CoT event on the stream.
                    </Alert>
                  )}
                  <Text fz="xs" c="dimmed">
                    Every field takes regular expressions, matched anywhere in the value. Anchor
                    with <code>^</code> and <code>$</code> for an exact match. All the fields you
                    fill in must match.
                  </Text>
                  {TAK_FIELDS.map((field) => (
                    <TagsInput
                      key={field.key}
                      label={field.label}
                      description={field.help}
                      value={listOf(source.config, field.key)}
                      onChange={(value) =>
                        void patch(source, { config: { ...source.config, [field.key]: value } })
                      }
                      clearable
                    />
                  ))}
                </Stack>
              )}

              {source.kind === "matrix" && (
                <Text fz="sm" c="dimmed">
                  Room {String(source.config.roomName ?? source.config.roomId)}
                </Text>
              )}
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>

      <AddSourceModal
        // Remounted per kind so the form starts empty without an effect.
        key={adding ?? "none"}
        kind={adding}
        rooms={rooms}
        onClose={() => setAdding(null)}
        onAdded={(id) => {
          setAdding(null);
          // Open it: a TAK setup is added empty and the next thing to do is
          // fill in its search.
          setOpened((prev) => [...prev, id]);
          void reload();
        }}
      />
    </Stack>
  );
};

const AddSourceModal = ({
  kind,
  rooms,
  onClose,
  onAdded,
}: {
  kind: "tak" | "matrix" | null;
  rooms: MatrixRoom[];
  onClose: () => void;
  onAdded: (id: string) => void;
}) => {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [madeRooms, setMadeRooms] = useState<MatrixRoom[]>([]);

  /**
   * Make a room the ingester can read. Needed because a room created in a Matrix
   * client is encrypted by default and Matrix cannot undo that, so an ingestible
   * room has to be made this way.
   */
  const createRoom = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const res = await ingestApi.ingest.matrix.rooms.$post({ json: { name: name.trim() } });
    setCreating(false);
    if (!res.ok) {
      notifications.show({ color: "red", message: `Could not create the room (${res.status})` });
      return;
    }
    const { roomId: made } = (await res.json()) as { roomId: string };
    setMadeRooms((prev) => [...prev, { roomId: made, name: `${name.trim()} (new)` }]);
    setRoomId(made);
    notifications.show({
      color: "teal",
      message: "Room created in the Space, unencrypted and ready to ingest.",
    });
  };

  const submit = async () => {
    if (!kind || !name.trim()) return;
    setSaving(true);
    const room = rooms.find((r) => r.roomId === roomId);
    // Posted per branch rather than through one variable: the request body is a
    // discriminated union, and a ternary widens it into something neither arm
    // accepts.
    const res =
      kind === "tak"
        ? await ingestApi.ingest.sources.$post({
            json: { kind: "tak", name: name.trim(), enabled: true, config: {} },
          })
        : await ingestApi.ingest.sources.$post({
            json: {
              kind: "matrix",
              name: name.trim(),
              enabled: true,
              config: { roomId, roomName: room?.name ?? room?.alias },
            },
          });
    setSaving(false);
    if (!res.ok) {
      notifications.show({ color: "red", message: `Could not add (${res.status})` });
      return;
    }
    onAdded(((await res.json()) as { id: string }).id);
  };

  return (
    <Modal
      opened={kind !== null}
      onClose={onClose}
      title={kind === "matrix" ? "Ingest a Matrix room" : "Add a TAK filter"}
    >
      <Stack>
        <TextInput
          label="Name"
          description="Yours, for this list."
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
        />
        {kind === "matrix" && (
          <>
            <Select
              label="Room"
              description="Rooms in this deployment's Matrix Space."
              data={[...madeRooms, ...rooms].map((room) => ({
                value: room.roomId,
                label: room.name ?? room.alias ?? room.roomId,
              }))}
              value={roomId}
              onChange={(value) => setRoomId(value ?? "")}
              searchable
              nothingFoundMessage="No rooms found"
            />
            <Alert color="gray" variant="light">
              The deployment's standard rooms are end-to-end encrypted and cannot be read, and a
              room made in Element is encrypted by default — Matrix cannot undo that afterwards.
              Create one here instead and it will be unencrypted, inside the Space, and joinable by
              anyone in it.
              <Button
                mt="sm"
                size="xs"
                variant="light"
                loading={creating}
                disabled={!name.trim()}
                onClick={() => void createRoom()}
              >
                Create "{name.trim() || "…"}" as an ingestible room
              </Button>
            </Alert>
          </>
        )}
        {kind === "tak" && (
          <Text fz="sm" c="dimmed">
            Add it first, then set the filters. A filter with nothing set takes every CoT event on
            the stream.
          </Text>
        )}
        <Button
          onClick={() => void submit()}
          loading={saving}
          disabled={!name.trim() || (kind === "matrix" && !roomId)}
        >
          Add
        </Button>
      </Stack>
    </Modal>
  );
};

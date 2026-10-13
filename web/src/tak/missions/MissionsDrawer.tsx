import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  FileButton,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconEye,
  IconEyeOff,
  IconLock,
  IconPlus,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";
import type { TakItem } from "../cot.ts";
import { ItemRow } from "../items/ItemsDrawer.tsx";
import { formatAge, labelOf } from "../items.ts";
import { useNow } from "../use-now.ts";
import { fetchMissionLog, fileUrl, type Mission, type MissionLogEntry } from "./missions.ts";
import type { MissionsState } from "./store.ts";
import {
  addFile,
  addLogEntry,
  canDelete,
  createMission,
  deleteMission,
  loadSubscription,
  removeFile,
  removeItem,
  subscribe,
  unsubscribe,
  useSubscriptions,
} from "./writes.ts";

type Props = {
  state: MissionsState;
  shown: ReadonlySet<string>;
  onToggleShown: (name: string) => void;
  open: string | undefined;
  onOpen: (name: string | undefined) => void;
  selectedUid: string | undefined;
  onPick: (item: TakItem) => void;
  /** Callsign for a TAK client uid, when that user is on the picture. */
  callsignOf: (uid: string) => string | undefined;
  /** Who this browser writes to TAK as; undefined without a callsign. */
  clientUid: string | undefined;
};

export const notifyFailure = (title: string) => (err: unknown) =>
  notifications.show({
    color: "red",
    title,
    message: err instanceof Error ? err.message : String(err),
  });

/** Runs one write at a time, telling the user when it fails. */
const useWrite = () => {
  const [busy, setBusy] = useState(false);
  /** Resolves true once the write is done, false when it failed. */
  const run = async (failureTitle: string, write: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await write();
      return true;
    } catch (err) {
      notifyFailure(failureTitle)(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
};

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${Math.round(bytes / 1024)} kB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label={title}>
    <Text className="tak-group-heading">{title}</Text>
    {children}
  </section>
);

const ShowToggle = ({
  mission,
  shown,
  onToggle,
}: {
  mission: Mission;
  shown: boolean;
  onToggle: () => void;
}) => (
  <Tooltip label={shown ? "Shown on the map" : "Not on the map"} withArrow>
    <ActionIcon
      variant="subtle"
      color="gray"
      size="sm"
      aria-pressed={shown}
      aria-label={`Show ${mission.name} on the map`}
      onClick={onToggle}
    >
      {shown ? <IconEye size={16} /> : <IconEyeOff size={16} />}
    </ActionIcon>
  </Tooltip>
);

const MissionLog = ({ name, callsignOf }: { name: string; callsignOf: Props["callsignOf"] }) => {
  const [entries, setEntries] = useState<MissionLogEntry[] | "failed">();
  useEffect(() => {
    const abort = new AbortController();
    setEntries(undefined);
    fetchMissionLog(name, abort.signal).then(setEntries, () => {
      if (!abort.signal.aborted) setEntries("failed");
    });
    return () => abort.abort();
  }, [name]);
  if (entries === undefined) return <Loader size="xs" m="xs" />;
  if (entries === "failed")
    return (
      <Text fz="xs" c="dimmed" p="xs">
        Couldn't load the log.
      </Text>
    );
  if (entries.length === 0)
    return (
      <Text fz="xs" c="dimmed" p="xs">
        No log entries.
      </Text>
    );
  return entries.map((entry) => (
    <div key={entry.id} className="tak-row">
      <Text fz="xs" c="dimmed">
        {new Date(entry.time).toLocaleString("fi-FI")}
        {entry.creatorUid ? ` · ${callsignOf(entry.creatorUid) ?? entry.creatorUid}` : ""}
      </Text>
      <Text fz="sm" style={{ whiteSpace: "pre-wrap" }}>
        {entry.content}
      </Text>
    </div>
  ));
};

const NewLogEntry = ({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (text: string) => Promise<boolean>;
}) => {
  const [text, setText] = useState("");
  const add = async () => {
    if (await onAdd(text.trim())) setText("");
  };
  return (
    <Group gap="xs" align="flex-end" wrap="nowrap" p="xs">
      <Textarea
        size="xs"
        style={{ flex: 1 }}
        placeholder="New log entry"
        aria-label="New log entry"
        autosize
        minRows={1}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
      />
      <Button
        size="xs"
        variant="default"
        disabled={disabled || !text.trim()}
        onClick={() => void add()}
      >
        Add
      </Button>
    </Group>
  );
};

const RemoveButton = ({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) => (
  <ActionIcon
    variant="subtle"
    color="gray"
    size="sm"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
  >
    <IconX size={14} />
  </ActionIcon>
);

const DeleteMission = ({
  mission,
  disabled,
  onDelete,
}: {
  mission: Mission;
  disabled: boolean;
  onDelete: () => void;
}) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        size="xs"
        variant="light"
        color="danger"
        leftSection={<IconTrash size={14} />}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        Delete mission
      </Button>
      <Modal
        opened={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${mission.name}?`}
        centered
      >
        <Stack gap="sm">
          <Text fz="sm">
            The mission is removed from TAK for every user, with its list of items, files and log.
            The map items themselves stay.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setConfirming(false)} data-autofocus>
              Cancel
            </Button>
            <Button
              size="xs"
              color="danger"
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

const MissionDetail = ({ mission, ...props }: Props & { mission: Mission }) => {
  const now = useNow(10_000);
  const { busy, run } = useWrite();
  const [logKey, setLogKey] = useState(0);
  const { clientUid } = props;
  const token = useSubscriptions().get(mission.name);
  const subscribed = typeof token === "string";
  const canWrite = !!clientUid && subscribed && !busy;
  useEffect(() => {
    if (clientUid) void loadSubscription(mission.name, clientUid).catch(() => undefined);
  }, [mission.name, clientUid]);
  const contents = props.state.contents.get(mission.name);
  const creator =
    mission.creatorUid && (props.callsignOf(mission.creatorUid) ?? mission.creatorUid);
  return (
    <Stack gap="xs" h="100%">
      <Group gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={() => props.onOpen(undefined)}
          aria-label="Back to missions"
        >
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Text fw={600} truncate>
          {mission.name}
        </Text>
      </Group>
      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        <Stack gap="sm">
          {mission.description && (
            <Text fz="sm" style={{ whiteSpace: "pre-wrap" }}>
              {mission.description}
            </Text>
          )}
          <Text fz="xs" c="dimmed">
            Created {new Date(mission.createTime).toLocaleDateString("fi-FI")}
            {creator ? ` by ${creator}` : ""}
          </Text>
          {mission.keywords.length > 0 && (
            <Group gap={4}>
              {mission.keywords.map((k) => (
                <Badge key={k} size="xs" variant="outline" color="gray">
                  {k}
                </Badge>
              ))}
            </Group>
          )}
          <Switch
            size="xs"
            label="Show on the map"
            checked={props.shown.has(mission.name)}
            onChange={() => props.onToggleShown(mission.name)}
          />
          {clientUid ? (
            <Group gap="xs">
              <Button
                size="xs"
                variant={subscribed ? "default" : "filled"}
                disabled={busy}
                onClick={() =>
                  void (subscribed
                    ? run("Couldn't unsubscribe", () => unsubscribe(mission.name, clientUid))
                    : run("Couldn't subscribe", () => subscribe(mission.name, clientUid)))
                }
              >
                {subscribed ? "Unsubscribe" : "Subscribe"}
              </Button>
              {canDelete(mission, clientUid) && (
                <DeleteMission
                  mission={mission}
                  disabled={busy}
                  onDelete={() =>
                    void run("Mission not deleted", () =>
                      deleteMission(mission.name, clientUid),
                    ).then((ok) => ok && props.onOpen(undefined))
                  }
                />
              )}
            </Group>
          ) : (
            <Text fz="xs" c="dimmed">
              No callsign: open BattleLog from the deploy app to change missions.
            </Text>
          )}
          {clientUid && !subscribed && (
            <Text fz="xs" c="dimmed">
              Subscribe to add items, files and log entries: TAK ignores changes from users who
              aren't subscribed.
            </Text>
          )}
          <Section
            title={`Items ${contents?.kind === "loaded" ? contents.items.length : mission.itemUids.length}`}
          >
            {contents?.kind === "no-access" && (
              <Text fz="xs" c="dimmed" p="xs">
                TAK didn't let you read this mission
                {mission.restricted ? " (password or invitation needed)" : ""}.
              </Text>
            )}
            {contents?.kind === "failed" && (
              <Text fz="xs" c="dimmed" p="xs">
                Couldn't load the items.
              </Text>
            )}
            {(contents === undefined || contents.kind === "loading") && <Loader size="xs" m="xs" />}
            {contents?.kind === "loaded" && contents.items.length < mission.itemUids.length && (
              <Text fz="xs" c="dimmed" px="xs">
                {mission.itemUids.length - contents.items.length} more entries aren't map items
                (e.g. chat messages).
              </Text>
            )}
            {contents?.kind === "loaded" &&
              contents.items.map((item) => (
                <Group key={item.uid} gap={4} wrap="nowrap">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ItemRow
                      item={item}
                      now={now}
                      selected={item.uid === props.selectedUid}
                      onPick={() => props.onPick(item)}
                    />
                  </div>
                  {subscribed && clientUid && (
                    <RemoveButton
                      label={`Remove ${labelOf(item)} from the mission`}
                      disabled={!canWrite}
                      onClick={() =>
                        void run("Item not removed", () =>
                          removeItem(mission.name, item.uid, clientUid),
                        )
                      }
                    />
                  )}
                </Group>
              ))}
            {contents?.kind === "loaded" && contents.items.length === 0 && subscribed && (
              <Text fz="xs" c="dimmed" p="xs">
                Add items from their details on the map.
              </Text>
            )}
          </Section>
          <Section title={`Files ${mission.files.length}`}>
            {mission.files.map((file) => (
              <Group key={file.uid} gap={4} wrap="nowrap" className="tak-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Anchor
                    fz="sm"
                    href={fileUrl(file)}
                    download={file.name}
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {file.name}
                  </Anchor>
                  <Text fz="xs" c="dimmed">
                    {formatSize(file.size)} · {formatAge(now - file.time)} ago
                    {file.submitter ? ` · ${file.submitter}` : ""}
                  </Text>
                </div>
                {subscribed && clientUid && (
                  <RemoveButton
                    label={`Remove ${file.name} from the mission`}
                    disabled={!canWrite}
                    onClick={() =>
                      void run("File not removed", () =>
                        removeFile(mission.name, file.hash, clientUid),
                      )
                    }
                  />
                )}
              </Group>
            ))}
            {subscribed && clientUid && (
              <FileButton
                onChange={(file) =>
                  file && void run("File not added", () => addFile(mission.name, file, clientUid))
                }
              >
                {(fileProps) => (
                  <Button
                    {...fileProps}
                    size="xs"
                    variant="subtle"
                    leftSection={<IconUpload size={14} />}
                    disabled={!canWrite}
                  >
                    Upload file
                  </Button>
                )}
              </FileButton>
            )}
          </Section>
          <Section title="Log">
            {subscribed && clientUid && (
              <NewLogEntry
                disabled={!canWrite}
                onAdd={async (text) => {
                  const ok = await run("Log entry not added", () =>
                    addLogEntry(mission.name, text, clientUid),
                  );
                  if (ok) setLogKey((k) => k + 1);
                  return ok;
                }}
              />
            )}
            <MissionLog key={logKey} name={mission.name} callsignOf={props.callsignOf} />
          </Section>
        </Stack>
      </ScrollArea>
    </Stack>
  );
};

const NewMission = ({
  clientUid,
  onCreated,
}: {
  clientUid: string | undefined;
  onCreated: (name: string) => void;
}) => {
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { busy, run } = useWrite();
  const trimmed = name.trim();
  const create = async () => {
    if (!clientUid) return;
    if (
      await run("Mission not created", () => createMission(trimmed, description.trim(), clientUid))
    ) {
      setOpened(false);
      setName("");
      setDescription("");
      onCreated(trimmed);
    }
  };
  return (
    <>
      <Tooltip
        label="No callsign: open BattleLog from the deploy app to create missions"
        disabled={!!clientUid}
        withArrow
      >
        <Button
          size="xs"
          variant="default"
          leftSection={<IconPlus size={14} />}
          disabled={!clientUid}
          onClick={() => setOpened(true)}
        >
          New mission
        </Button>
      </Tooltip>
      <Modal opened={opened} onClose={() => setOpened(false)} title="New mission" centered>
        <Stack gap="sm">
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={trimmed.includes("/") ? "A name can't contain /" : undefined}
            data-autofocus
          />
          <Textarea
            label="Description"
            autosize
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <Text fz="xs" c="dimmed">
            Everyone on TAK can see and subscribe to it; you can delete it later.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              loading={busy}
              disabled={!trimmed || trimmed.includes("/")}
              onClick={() => void create()}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

const MissionList = (props: Props) => {
  const now = useNow(10_000);
  const { missions, listFailed } = props.state;
  if (missions === null)
    return listFailed ? (
      <Text fz="sm" c="dimmed" p="xs">
        Couldn't load missions from TAK.
      </Text>
    ) : (
      <Loader size="xs" m="xs" />
    );
  if (missions.length === 0)
    return (
      <Text fz="sm" c="dimmed" p="xs">
        No missions on this TAK server yet.
      </Text>
    );
  const sorted = [...missions].sort((a, b) => b.changedAt - a.changedAt);
  return (
    <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars>
      {sorted.map((mission) => (
        <Group key={mission.name} gap={4} wrap="nowrap" className="tak-row">
          <UnstyledButton
            style={{ flex: 1, minWidth: 0 }}
            onClick={() => props.onOpen(mission.name)}
          >
            <Group gap={4} wrap="nowrap">
              {mission.restricted && <IconLock size={12} aria-label="Restricted" />}
              <Text fz="sm" fw={600} truncate>
                {mission.name}
              </Text>
            </Group>
            <Text fz="xs" c="dimmed" truncate>
              {mission.itemUids.length} items · {mission.files.length} files · changed{" "}
              {formatAge(now - mission.changedAt)} ago
            </Text>
          </UnstyledButton>
          <ShowToggle
            mission={mission}
            shown={props.shown.has(mission.name)}
            onToggle={() => props.onToggleShown(mission.name)}
          />
        </Group>
      ))}
    </ScrollArea>
  );
};

/** TAK missions (Data Sync): what each holds, which ones the map shows, and changes to them. */
export const MissionsDrawer = (props: Props) => {
  const open = props.state.missions?.find((m) => m.name === props.open);
  if (open) return <MissionDetail {...props} mission={open} />;
  return (
    <Stack gap="xs" h="100%">
      <Group justify="flex-end">
        <NewMission clientUid={props.clientUid} onCreated={props.onOpen} />
      </Group>
      <MissionList {...props} />
    </Stack>
  );
};

import {
  ActionIcon,
  Anchor,
  Badge,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconArrowLeft, IconEye, IconEyeOff, IconLock } from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";
import type { TakItem } from "../cot.ts";
import { ItemRow } from "../items/ItemsDrawer.tsx";
import { formatAge } from "../items.ts";
import { useNow } from "../use-now.ts";
import { fetchMissionLog, fileUrl, type Mission, type MissionLogEntry } from "./missions.ts";
import type { MissionsState } from "./store.ts";

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

const MissionDetail = ({ mission, ...props }: Props & { mission: Mission }) => {
  const now = useNow(10_000);
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
                <ItemRow
                  key={item.uid}
                  item={item}
                  now={now}
                  selected={item.uid === props.selectedUid}
                  onPick={() => props.onPick(item)}
                />
              ))}
          </Section>
          {mission.files.length > 0 && (
            <Section title={`Files ${mission.files.length}`}>
              {mission.files.map((file) => (
                <div key={file.uid} className="tak-row">
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
              ))}
            </Section>
          )}
          <Section title="Log">
            <MissionLog name={mission.name} callsignOf={props.callsignOf} />
          </Section>
        </Stack>
      </ScrollArea>
    </Stack>
  );
};

/** TAK missions (Data Sync): what each holds, and which ones the map shows. */
export const MissionsDrawer = (props: Props) => {
  const now = useNow(10_000);
  const { missions, listFailed } = props.state;
  const open = missions?.find((m) => m.name === props.open);
  if (open) return <MissionDetail {...props} mission={open} />;
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
        No missions on this TAK server. Missions are created in ATAK's Data Sync.
      </Text>
    );
  const sorted = [...missions].sort((a, b) => b.changedAt - a.changedAt);
  return (
    <ScrollArea h="100%" offsetScrollbars>
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

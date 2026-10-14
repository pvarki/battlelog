import {
  ActionIcon,
  Button,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { IconEye, IconEyeOff, IconLock } from "@tabler/icons-react";
import { useEffect } from "react";
import type { TakItem } from "../cot.ts";
import { formatAge } from "../items.ts";
import { useNow } from "../use-now.ts";
import { missionTree, useMissionParents } from "./hierarchy.ts";
import { MissionDetail } from "./MissionDetail.tsx";
import type { Mission } from "./missions.ts";
import { NewMission } from "./NewMission.tsx";
import { Section, useWrite } from "./shared.tsx";
import { type MissionsState, refreshMissions } from "./store.ts";
import { loadSubscription, subscribe, useSubscriptions } from "./writes.ts";

export type MissionsDrawerProps = {
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

type ListView = "list" | "tree";

const MissionList = ({ view, ...props }: MissionsDrawerProps & { view: ListView }) => {
  const now = useNow(10_000);
  const { missions, listFailed } = props.state;
  const parents = useMissionParents(missions?.map((m) => m.name) ?? [], view === "tree");
  if (missions === null)
    return listFailed ? (
      <Text fz="sm" c="dimmed" p="xs">
        Couldn't load Data Sync feeds from TAK.
      </Text>
    ) : (
      <Loader size="xs" m="xs" />
    );
  if (missions.length === 0)
    return (
      <Text fz="sm" c="dimmed" p="xs">
        No Data Sync feeds on this TAK server yet.
      </Text>
    );
  const rows =
    view === "tree"
      ? missionTree(missions, parents)
      : [...missions]
          .sort((a, b) => b.changedAt - a.changedAt)
          .map((mission) => ({ mission, depth: 0 }));
  return (
    <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars>
      {rows.map(({ mission, depth }) => (
        <Group
          key={mission.name}
          gap={4}
          wrap="nowrap"
          className="tak-row"
          data-depth={depth || undefined}
          style={depth ? { marginLeft: (depth - 1) * 14 + 6 } : undefined}
        >
          <UnstyledButton
            style={{ flex: 1, minWidth: 0 }}
            onClick={() => props.onOpen(mission.name)}
          >
            <Group gap={4} wrap="nowrap">
              {(mission.passwordProtected || mission.inviteOnly) && (
                <IconLock
                  size={12}
                  aria-label={mission.inviteOnly ? "Invite-only" : "Password-protected"}
                />
              )}
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

/** Invitations this client hasn't taken up yet, each joined with one click. */
const MyInvitations = ({
  state,
  clientUid,
  onOpen,
}: {
  state: MissionsState;
  clientUid: string;
  onOpen: (name: string) => void;
}) => {
  const subscriptions = useSubscriptions();
  const { busy, run } = useWrite();
  const key = state.invitations.join("\n");
  useEffect(() => {
    for (const name of key.split("\n")) {
      if (name) void loadSubscription(name, clientUid).catch(() => undefined);
    }
  }, [key, clientUid]);
  const pending = state.invitations.filter((name) => !subscriptions.get(name));
  if (pending.length === 0) return null;
  const join = async (name: string) => {
    const mission = state.missions?.find((m) => m.name === name);
    await subscribe(name, clientUid, undefined, mission);
    await refreshMissions([name]);
  };
  return (
    <Section title="Invitations for me">
      {pending.map((name) => (
        <Group key={name} gap="xs" wrap="nowrap" className="tak-row">
          <Text fz="sm" fw={600} truncate style={{ flex: 1, minWidth: 0 }}>
            {name}
          </Text>
          <Button
            size="xs"
            disabled={busy}
            onClick={() =>
              void run(`Couldn't join ${name}`, () => join(name)).then((ok) => ok && onOpen(name))
            }
          >
            Join
          </Button>
        </Group>
      ))}
    </Section>
  );
};

/** TAK missions (Data Sync): what each holds, which ones the map shows, and changes to them. */
export const MissionsDrawer = (props: MissionsDrawerProps) => {
  const [view, setView] = useLocalStorage<ListView>({
    key: "battlelog.tak.missionsView",
    defaultValue: "list",
  });
  const open = props.state.missions?.find((m) => m.name === props.open);
  if (open) return <MissionDetail {...props} mission={open} />;
  return (
    <Stack gap="xs" h="100%">
      <Group justify="space-between" wrap="nowrap">
        <Text fz="xs" c="dimmed" style={{ flex: 1, minWidth: 0 }}>
          Feeds are missions on TAK Server.
        </Text>
        <NewMission clientUid={props.clientUid} onCreated={props.onOpen} />
      </Group>
      {props.clientUid && (
        <MyInvitations state={props.state} clientUid={props.clientUid} onOpen={props.onOpen} />
      )}
      <SegmentedControl
        size="xs"
        value={view}
        onChange={(v) => setView(v as ListView)}
        data={[
          { value: "list", label: "List" },
          { value: "tree", label: "Tree" },
        ]}
        aria-label="Show feeds as"
      />
      <MissionList {...props} view={view} />
    </Stack>
  );
};
